import { useCallback, useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'

const num = v => Number(v) || 0

/**
 * Apply a payment to one or more open payables.
 *
 * A payment often settles several invoices at once — a $1,690.27 payment to the
 * Village against two bills of $845.14 — which is why `apply_payment_application`
 * takes an array and why the running total against the payment amount is the
 * most important number on the screen.
 *
 * Two paths, and the difference matters:
 *
 * - **Tick several → Apply.** `apply_payment_application` builds the entry from
 *   `preview_payment_application` and REFUSES a transaction that already
 *   carries one ("clear it first"). It is the right path for a payment being
 *   coded for the first time across one or more invoices.
 * - **"Just this one".** `apply_invoice` goes through `set_journal_override`,
 *   which REPLACES whatever entry the transaction has — so it is the only way
 *   to re-point a payment that is already coded at the invoice it settles. It
 *   also attaches the invoice document to the paying transaction, refuses an
 *   overpayment by name, and settles the lesser of the two amounts so a part
 *   payment leaves the rest outstanding.
 *
 * `invoice_candidates` scores what it thinks fits and says WHY. Everything else
 * still open is listed underneath, because the engine scores on vendor and date
 * and cannot know about a bill paid under another name.
 *
 * Preview first: applying writes the lines and stamps settles_receipt_id.
 */
export default function PayablesApply({ txn, onDone }) {
  const [cands, setCands] = useState(null)
  const [open, setOpen] = useState([])
  const [picked, setPicked] = useState([])
  const [preview, setPreview] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setErr(''); setCands(null); setPreview(null); setPicked([])
    try {
      const [c, o] = await Promise.all([
        rpc('invoice_candidates', { p_txn: txn.id }).catch(() => []),
        rpc('open_payables_for', { p_txn: txn.id }).catch(() => []),
      ])
      setCands(c); setOpen(o)
    } catch (e) { setErr(e.message) }
  }, [txn.id])

  useEffect(() => { load() }, [load])

  const toggle = id =>
    setPicked(p => { setPreview(null); return p.includes(id) ? p.filter(x => x !== id) : [...p, id] })

  const balanceOf = id => {
    const c = (cands || []).find(x => x.receipt_id === id)
    if (c) return num(c.balance)
    const o = open.find(x => x.receipt_id === id)
    return o ? num(o.balance) : 0
  }

  const selected = picked.reduce((a, id) => a + balanceOf(id), 0)
  const payment = num(txn.amount)
  const diff = Math.round((payment - selected) * 100) / 100

  async function doPreview() {
    setBusy('preview'); setErr(''); setMsg('')
    try {
      setPreview(await rpc('preview_payment_application', { p_txn: txn.id, p_receipts: picked }))
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  /**
   * One invoice, through the override path. Offered on every row because the
   * multi-invoice path cannot touch a transaction that is already coded, and
   * "this payment is already coded, but at the wrong thing" is a real and
   * frequent case.
   */
  async function applyOne(receiptId, vendor) {
    setBusy(receiptId); setErr(''); setMsg('')
    try {
      const lines = await rpc('apply_invoice', { p_txn: txn.id, p_receipt: receiptId })
      setMsg(`Applied to ${vendor} — ${lines.length} line${lines.length === 1 ? '' : 's'} posted.`)
      setPreview(null); setPicked([])
      await load()
      if (onDone) onDone()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  async function apply() {
    setBusy('apply'); setErr(''); setMsg('')
    try {
      const lines = await rpc('apply_payment_application', { p_txn: txn.id, p_receipts: picked })
      setMsg(`Applied — ${lines.length} line${lines.length === 1 ? '' : 's'} posted against ${picked.length} invoice${picked.length === 1 ? '' : 's'}.`)
      setPreview(null); setPicked([])
      await load()
      if (onDone) onDone()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  if (!cands) return <div className="loading">Looking for invoices…</div>

  // Candidates first, then anything else still open that wasn't scored.
  const candIds = new Set(cands.map(c => c.receipt_id))
  const others = open.filter(o => !candIds.has(o.receipt_id))

  return (
    <div className="note" style={{ marginBottom: 8 }}>
      <b>Apply this payment to invoices</b>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        Payment is <b>${money(payment)}</b>. Tick what it settles — a payment may cover several.
      </div>

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      {cands.length === 0 && others.length === 0 && (
        <div className="muted" style={{ marginTop: 6 }}>No open payables to apply this to.</div>
      )}

      {cands.length > 0 && (
        <table style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th style={{ width: 28 }} />
              <th>Vendor</th>
              <th style={{ width: 120 }}>Reference</th>
              <th style={{ width: 96 }}>Dated</th>
              <th className="num" style={{ width: 110 }}>Balance</th>
              <th className="num" style={{ width: 60 }}>Score</th>
              <th style={{ width: 230 }}>Why</th>
              <th style={{ width: 96 }} />
            </tr>
          </thead>
          <tbody>
            {cands.map(c => (
              <tr key={c.receipt_id} className={picked.includes(c.receipt_id) ? 'rowsel' : ''}>
                <td>
                  <input type="checkbox" checked={picked.includes(c.receipt_id)}
                         onChange={() => toggle(c.receipt_id)} />
                </td>
                <td>{c.vendor}</td>
                <td className="muted">{c.reference}</td>
                <td>{c.doc_date}</td>
                <td className="money">${money(c.balance)}</td>
                <td className="money">
                  <span className={'pill ' + (num(c.score) >= 40 ? 'soft' : 'hold')}>{c.score}</span>
                </td>
                <td className="muted" style={{ fontSize: 11.5 }}>{c.why}</td>
                <td>
                  <button disabled={!!busy} style={{ padding: '1px 8px', fontSize: 11 }}
                          title="Apply just this invoice. Replaces whatever entry this payment already has — the only path that works on a payment already coded."
                          onClick={() => applyOne(c.receipt_id, c.vendor)}>
                    {busy === c.receipt_id ? 'applying…' : 'just this one'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {others.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button onClick={() => setShowAll(s => !s)}>
            {showAll ? 'Hide' : `Show the other ${others.length} open payable${others.length === 1 ? '' : 's'}`}
          </button>
          {showAll && (
            <table style={{ marginTop: 4 }}>
              <tbody>
                {others.map(o => (
                  <tr key={o.receipt_id} className={picked.includes(o.receipt_id) ? 'rowsel' : ''}>
                    <td style={{ width: 28 }}>
                      <input type="checkbox" checked={picked.includes(o.receipt_id)}
                             onChange={() => toggle(o.receipt_id)} />
                    </td>
                    <td><span className="pill">{o.business}</span></td>
                    <td>
                      {o.doc_vendor}
                      {o.same_vendor && <span className="pill soft">same vendor</span>}
                    </td>
                    <td style={{ width: 120 }} className="muted">{o.doc_reference}</td>
                    <td style={{ width: 96 }}>{o.doc_date}</td>
                    <td className="money" style={{ width: 110 }}>${money(o.balance)}</td>
                    <td style={{ width: 96 }}>
                      <button disabled={!!busy} style={{ padding: '1px 8px', fontSize: 11 }}
                              title="Apply just this invoice. Replaces whatever entry this payment already has."
                              onClick={() => applyOne(o.receipt_id, o.doc_vendor)}>
                        {busy === o.receipt_id ? 'applying…' : 'just this one'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {picked.length > 0 && (
        <>
          <div className="bar" style={{ margin: '8px 0 0' }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {picked.length} selected · ${money(selected)} of ${money(payment)}
            </span>
            <span className={Math.abs(diff) < 0.005 ? 'pos' : 'due-soon'} style={{ fontSize: 12 }}>
              {Math.abs(diff) < 0.005
                ? 'settles the payment exactly'
                : diff > 0
                  ? `$${money(diff)} of the payment left over`
                  : `$${money(-diff)} more than the payment`}
            </span>
            <span style={{ flex: 1 }} />
            <button disabled={!!busy} onClick={doPreview}>
              {busy === 'preview' ? 'Checking…' : 'Preview the entry'}
            </button>
          </div>

          {Math.abs(diff) > 0.005 && (
            <div className="note warn" style={{ marginTop: 8 }}>
              The selected invoices do not add up to the payment. That is sometimes right — a part
              payment, or a bill paid alongside something else — but check it is what you mean
              before applying.
            </div>
          )}
        </>
      )}

      {preview && (
        <div className="note" style={{ marginTop: 8 }}>
          <b>What would be posted</b>
          <table style={{ marginTop: 6 }}>
            <tbody>
              {preview.map((l, i) => (
                <tr key={i}>
                  <td style={{ width: 60 }}><span className="pill">{l.business}</span></td>
                  <td style={{ width: 90 }} className="muted">{l.gl_number}</td>
                  <td>
                    {l.gl_name}
                    {l.memo && <div className="muted" style={{ fontSize: 11 }}>{l.memo}</div>}
                  </td>
                  <td className="money" style={{ width: 110 }}>{num(l.debit) ? money(l.debit) : ''}</td>
                  <td className="money" style={{ width: 110 }}>{num(l.credit) ? money(l.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="bar" style={{ margin: '8px 0 0' }}>
            <button className="primary" disabled={!!busy} onClick={apply}>
              {busy === 'apply' ? 'Applying…' : 'Apply and post'}
            </button>
            <button onClick={() => setPreview(null)}>Cancel</button>
            <span className="muted" style={{ fontSize: 12 }}>
              Applying stamps each invoice as settled by this payment.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
