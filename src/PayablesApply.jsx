import { useCallback, useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'

const num = v => Number(v) || 0

/**
 * One row per invoice, not one per entity.
 *
 * v_ap_outstanding carries a row per ENTITY per invoice, so a power bill split
 * 50/50 arrives as two rows sharing a single receipt_id — BMS 54.08 and BRA
 * 54.09 of one $108.17 document. `picked` holds receipt_ids, which made that
 * pair behave as one tick (right, since apply_payment_application settles the
 * whole invoice across both books) while the running total added it up with
 * .find(), which sees only the first row. A $108.17 invoice counted as $54.09
 * and the bar announced a $54.08 shortfall that did not exist. T004165 against
 * 506031-134516 could not be applied because of it.
 *
 * Collapsing here rather than in SQL keeps the entity split visible — the
 * caller still gets `businesses` to show which books it lands in.
 */
function byInvoice(rows) {
  const out = new Map()
  for (const r of rows || []) {
    const seen = out.get(r.receipt_id)
    if (seen) {
      seen.balance = Math.round((seen.balance + num(r.balance)) * 100) / 100
      if (r.business && !seen.businesses.includes(r.business)) seen.businesses.push(r.business)
      // Keep the strongest reason: the rows differ only by entity, but a
      // scored list can hand back the same invoice with different scores.
      if (num(r.score) > num(seen.score)) { seen.score = r.score; seen.why = r.why }
    } else {
      out.set(r.receipt_id, {
        ...r,
        balance: num(r.balance),
        businesses: r.business ? [r.business] : [],
      })
    }
  }
  return [...out.values()]
}

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
export default function PayablesApply({ txn, onDone, onPicked }) {
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
      setCands(byInvoice(c)); setOpen(byInvoice(o))
    } catch (e) { setErr(e.message) }
  }, [txn.id])

  useEffect(() => { load() }, [load])

  // The editor below needs to know a payable is ticked, so it can refuse to
  // save a plain entry over the top of a settlement you were part way through.
  useEffect(() => { if (onPicked) onPicked(picked.length) }, [picked, onPicked])

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

      {/* The action bar sits ABOVE the lists. It used to be underneath them, so
          with the other open payables expanded you ticked a row at the top and
          the only way to post it was off the bottom of the screen. */}
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
            <button className="primary" disabled={!!busy} onClick={apply}>
              {busy === 'apply' ? 'Applying…' : 'Apply and post'}
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
              <tr key={c.receipt_id} className={picked.includes(c.receipt_id) ? 'rowsel' : ''}
                  style={{ cursor: 'pointer' }} onClick={() => toggle(c.receipt_id)}>
                <td>
                  <input type="checkbox" checked={picked.includes(c.receipt_id)}
                         onClick={e => e.stopPropagation()}
                         onChange={() => toggle(c.receipt_id)} />
                </td>
                <td>
                  {c.vendor}
                  {c.businesses.length > 1 && (
                    <span className="pill soft" title="Split across these books — applying settles all of it">
                      {c.businesses.join(' + ')}
                    </span>
                  )}
                </td>
                <td className="muted">{c.reference}</td>
                <td>{c.doc_date}</td>
                <td className="money">${money(c.balance)}</td>
                <td className="money">
                  <span className={'pill ' + (num(c.score) >= 40 ? 'soft' : 'hold')}>{c.score}</span>
                </td>
                <td className="muted" style={{ fontSize: 11.5 }}>{c.why}</td>
                <td onClick={e => e.stopPropagation()}>
                  {c.businesses.length > 1 ? (
                    /* apply_invoice writes a two-sided entry for ONE payable
                       entity, so it cannot settle a split invoice — it used to
                       read the balance with SELECT INTO over a GROUP BY and
                       quietly keep one half. Offering the button here only
                       leads to a refusal, so point at the path that works. */
                    <button disabled style={{ padding: '1px 8px', fontSize: 11 }}
                            title={`Split across ${c.businesses.join(' + ')}. Tick the row and use "Apply and post", which settles every side.`}>
                      tick it instead
                    </button>
                  ) : (
                    <button disabled={!!busy} style={{ padding: '1px 8px', fontSize: 11 }}
                            title="Apply just this invoice. Replaces whatever entry this payment already has — the only path that works on a payment already coded."
                            onClick={() => applyOne(c.receipt_id, c.vendor)}>
                      {busy === c.receipt_id ? 'applying…' : 'just this one'}
                    </button>
                  )}
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
                  <tr key={o.receipt_id} className={picked.includes(o.receipt_id) ? 'rowsel' : ''}
                      style={{ cursor: 'pointer' }} onClick={() => toggle(o.receipt_id)}>
                    <td style={{ width: 28 }}>
                      <input type="checkbox" checked={picked.includes(o.receipt_id)}
                             onClick={e => e.stopPropagation()}
                             onChange={() => toggle(o.receipt_id)} />
                    </td>
                    <td>
                      <span className="pill" title={o.businesses.length > 1
                        ? 'Split across these books — applying settles all of it' : undefined}>
                        {o.businesses.join(' + ') || o.business}
                      </span>
                    </td>
                    <td>
                      {o.doc_vendor}
                      {o.same_vendor && <span className="pill soft">same vendor</span>}
                    </td>
                    <td style={{ width: 120 }} className="muted">{o.doc_reference}</td>
                    <td style={{ width: 96 }}>{o.doc_date}</td>
                    <td className="money" style={{ width: 110 }}>${money(o.balance)}</td>
                    <td style={{ width: 96 }} onClick={e => e.stopPropagation()}>
                      {o.businesses.length > 1 ? (
                        <button disabled style={{ padding: '1px 8px', fontSize: 11 }}
                                title={`Split across ${o.businesses.join(' + ')}. Tick the row and use "Apply and post", which settles every side.`}>
                          tick it instead
                        </button>
                      ) : (
                        <button disabled={!!busy} style={{ padding: '1px 8px', fontSize: 11 }}
                                title="Apply just this invoice. Replaces whatever entry this payment already has."
                                onClick={() => applyOne(o.receipt_id, o.doc_vendor)}>
                          {busy === o.receipt_id ? 'applying…' : 'just this one'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
