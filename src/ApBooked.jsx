import { useCallback, useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'

const num = v => Number(v) || 0

/**
 * "Booked to payables here" — the invoice this system posted itself, shown
 * from the payment that clears it.
 *
 * The distinction this pane exists to make: the expense and its GST were
 * booked against the *invoice* date. This transaction clears the payable. It
 * does not expense anything a second time, and coding it as an expense in the
 * journal editor would double the cost and leave the payable open.
 *
 * So the button posts through `apply_payment_application`, the same path as
 * the "Apply to an invoice" fold — that is the only call that stamps
 * `settles_receipt_id`, and that stamp is the only thing marking an invoice
 * paid.
 */
export default function ApBooked({ txnId, onDone, onCount }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    try {
      const r = await rpc('web_txn_apbook', { p_txn: txnId })
      setRows(r)
      if (onCount) onCount(r.length ? (r[0].vendor || 'booked') : '')
    } catch (e) { setErr(e.message) }
  }, [txnId, onCount])

  useEffect(() => { setRows(null); load() }, [load])

  async function build() {
    const ids = [...new Set((rows || []).map(r => r.receipt_id).filter(Boolean))]
    if (!ids.length) {
      setErr('This invoice has no id on it — open “Apply to an invoice” instead.')
      return
    }
    setBusy(true); setErr(''); setMsg('')
    try {
      const pl = await rpc('apply_payment_application', {
        p_txn: txnId, p_receipts: ids,
      })
      const ents = [...new Set((pl || []).map(l => l.business))]
      setMsg(`Applied: ${pl.length} lines across ${ents.join(' and ')}, `
           + `clearing ${ids.length} invoice${ids.length === 1 ? '' : 's'}.`)
      await load()
      if (onDone) onDone()
    } catch (e) {
      if (/already carries an entry/i.test(e.message || '')) {
        setMsg('Already applied — this payment carries its entry. Nothing was changed.')
        await load()
      } else setErr(e.message)
    }
    setBusy(false)
  }

  if (err && !rows) return <div className="err">{err}</div>
  if (!rows) return <div className="loading">Reading…</div>
  if (!rows.length) return null

  const head = rows[0]
  const entries = [...new Set(rows.map(r => `${r.business} entry ${r.entry_no}`))]

  return (
    <div className="note apbook">
      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      <b>Booked to payables here — {head.vendor}{head.reference ? ' ' + head.reference : ''}</b>
      {head.entry_date && <span className="muted"> · invoice dated {head.entry_date}</span>}
      <div style={{ marginTop: 3 }}>
        {entries.map(s => (
          <span key={s} className="pill" title="The ledger number of the invoice entry">{s}</span>
        ))}
      </div>

      <table style={{ marginTop: 4 }}>
        <tbody>
          {rows.map((x, i) => (
            <tr key={i}>
              <td style={{ width: '8%' }}><b>{x.business}</b></td>
              <td style={{ width: '14%' }} className="muted">{x.account}</td>
              <td>{x.name}</td>
              <td className="money" style={{ width: '16%' }}>{num(x.debit) ? '$' + money(x.debit) : ''}</td>
              <td className="money" style={{ width: '16%' }}>{num(x.credit) ? '$' + money(x.credit) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="fine" style={{ marginTop: 3 }}>
        The expense and GST were booked against the invoice date. This transaction
        clears the payable — it does not expense anything again.{' '}
        {head.payment_side
          ? `The payment side is ${head.payment_side}.`
          : 'The payment side has not been written yet.'}
      </div>

      {!head.payment_side && (
        <div style={{ marginTop: 7 }}>
          <button className="primary" disabled={busy} onClick={build}>
            {busy ? 'Building…' : 'Build the entry that clears this payable'}
          </button>
          <span className="muted" style={{ marginLeft: 6, fontSize: 11.5 }}>
            Same as ticking it under “Apply to an invoice”.
          </span>
        </div>
      )}
    </div>
  )
}
