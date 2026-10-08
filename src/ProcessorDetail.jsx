import { useCallback, useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'

const num = v => Number(v) || 0

/**
 * "What PayPal / Apple say this was" — the processor report rows behind a bank
 * line, from `processor_detail_for`.
 *
 * PayPal and Apple are payment methods, not vendors. The bank line says
 * "PAYPAL *APPLE.COM/BILL" or just "PREAUTHORIZED DEBIT PAYPAL"; the PayPal
 * activity export names who was actually paid, and Apple's purchase history
 * names every item in the order. Both are loaded by the sweep from the drop
 * folders and matched to the bank line before anyone opens it.
 *
 * An Apple item the hub has never seen holds the whole order — there is no
 * default to Personal any more, because a default is how a new business
 * subscription would have disappeared into PER without anyone noticing. The
 * "Code it" control here saves the item to `apple_item_map` through
 * `code_apple_item`, so every later month follows, and posts the order when it
 * was the last item missing. An item shared across entities (Groundwire) is
 * set in apple_item_map directly.
 */
export default function ProcessorDetail({ txnId, accounts = [], entities = [], onDone, onCount }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [pick, setPick] = useState({})

  const load = useCallback(async () => {
    setErr('')
    try {
      const r = await rpc('processor_detail_for', { p_txn: txnId })
      setRows(r)
      if (onCount) {
        const open = r.filter(x => /NOT CODED/.test(x.coding || '')).length
        const src = [...new Set(r.map(x => x.source))].join(' + ')
        onCount(r.length ? (open ? `${src} · ${open} not coded` : src) : '')
      }
    } catch (e) { setErr(e.message) }
  }, [txnId, onCount])

  useEffect(() => { setRows(null); setMsg(''); setPick({}); load() }, [load])

  async function code(r) {
    const k = r.ref + ':' + r.line_no
    const p = pick[k] || {}
    if (!p.business || !p.account) { setErr('Pick the entity and the account first.'); return }
    setBusy(k); setErr(''); setMsg('')
    try {
      const out = await rpc('code_apple_item', {
        p_txn: txnId, p_item: r.item, p_publisher: r.merchant,
        p_business: p.business, p_gl_number: p.account,
      })
      setMsg((out[0] && out[0].outcome) || 'Coded.')
      await load()
      if (onDone) onDone()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  if (err && !rows) return <div className="err">{err}</div>
  if (!rows) return <div className="loading">Reading…</div>
  if (!rows.length) return null

  const setP = (k, f, v) => setPick(s => ({ ...s, [k]: { ...(s[k] || {}), [f]: v, ...(f === 'business' ? { account: '' } : {}) } }))

  return (
    <div>
      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}
      <table>
        <thead>
          <tr>
            <th>From</th><th>Date</th><th>Item</th><th>Paid to / publisher</th>
            <th className="num">Amount</th><th>Coded to</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const k = r.ref + ':' + r.line_no
            const open = /NOT CODED/.test(r.coding || '')
            const p = pick[k] || {}
            return (
              <tr key={k}>
                <td className="muted" title={r.ref}>{r.source}</td>
                <td className="muted">{r.line_date}</td>
                <td>{r.item || '—'}</td>
                <td>{r.merchant}</td>
                <td className="num">
                  {r.currency !== 'CAD'
                    ? <>{r.currency} {money(r.amount)}{r.cad_amount != null && <div className="muted" style={{ fontSize: 11 }}>${money(r.cad_amount)} CAD</div>}</>
                    : <>${money(r.amount)}</>}
                </td>
                <td>
                  {!open && <span className={r.source === 'Apple' && r.line_no !== 999 ? 'pill' : 'muted'}>{r.coding}</span>}
                  {open && (
                    <div className="bar" style={{ margin: 0, gap: 4 }}>
                      <span className="pill hold">not coded</span>
                      <select value={p.business || ''} onChange={e => setP(k, 'business', e.target.value)}>
                        <option value="">entity</option>
                        {entities.map(b => <option key={b.code} value={b.code}>{b.code}</option>)}
                      </select>
                      <select value={p.account || ''} onChange={e => setP(k, 'account', e.target.value)}
                              disabled={!p.business} style={{ maxWidth: 220 }}>
                        <option value="">account</option>
                        {accounts.filter(a => a.business === p.business).map(a => (
                          <option key={a.number} value={a.number}>{a.number} {a.name}</option>
                        ))}
                      </select>
                      <button disabled={!!busy} onClick={() => code(r)}
                              title="Remembered for every later order with this item. Posts the order if this was the last item missing.">
                        {busy === k ? 'Saving…' : 'Code it'}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
