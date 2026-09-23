import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money } from './format.js'
import { useEntities } from './useEntities.js'
import DocLink from './DocLink.jsx'
import Section from './Section.jsx'
import ReceiptLines from './ReceiptLines.jsx'

const num = v => Number(v) || 0

/**
 * Queue 1 — Allocate invoices.
 *
 * A document typed as an invoice, with no entry against it. Booking it puts the
 * expense and its GST on the books at the INVOICE date and raises a payable.
 * The payment that clears that payable is a separate transaction and a separate
 * entry — which is why coding a payment as an expense doubles the cost.
 *
 * A CREDIT NOTE is the same entry with its sides swapped, not an invoice with
 * minus signs in it. That decision is made once, in `web_invoice_seed`, rather
 * than here — building it negative in the browser meant swapping every debit
 * and credit by hand, and skipping the GST line entirely because its amount was
 * below zero rather than above it.
 */
export default function Invoices() {
  const [rows, setRows] = useState(null)
  const [sel, setSel] = useState(null)
  const [lines, setLines] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [projects, setProjects] = useState([])
  const [gstRole, setGstRole] = useState({})     // business code -> GST account
  const [followup, setFollowup] = useState(null) // receipts found after booking
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const entities = useEntities()

  const load = useCallback(async () => {
    setErr(''); setRows(null); setSel(null); setLines(null); setFollowup(null)
    try { setRows(await rpc('web_invoice_queue')) }
    catch (e) { setErr(e.message) }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    supabase.from('v_chart_of_accounts').select('business,number,name')
      .eq('usable', true).eq('postable', true).order('business').order('number')
      .then(({ data }) => setAccounts(data || []))
    supabase.from('projects').select('id,name').eq('active', true).order('name')
      .then(({ data }) => setProjects(data || []))
    // GST paid is declared per entity — it is not the same number in every
    // chart — so the mapping is read rather than assumed.
    supabase.from('business_gl_roles').select('role,businesses(code),gl_accounts(number)')
      .eq('role', 'gst_paid')
      .then(({ data }) => setGstRole(Object.fromEntries(
        (data || [])
          .filter(r => r.businesses && r.gl_accounts)
          .map(r => [r.businesses.code, r.gl_accounts.number]))))
  }, [])

  const accountsFor = b => accounts.filter(a => a.business === b)

  async function open(r) {
    if (sel === r.id) { setSel(null); setLines(null); return }
    setSel(r.id); setLines(null); setErr(''); setMsg(''); setFollowup(null)
    try {
      const seed = await rpc('web_invoice_seed', { p_receipt: r.id })
      setLines(seed.map(l => ({
        business: l.business || '',
        account: l.account || '',
        debit: num(l.debit) || '',
        credit: num(l.credit) || '',
        role: l.role,
        projects: [],
      })))
    } catch (e) { setErr(e.message) }
  }

  /**
   * Changing the business must refill the accounts that have only one possible
   * value, and must NOT clear the expense account the reader chose. The console
   * cleared all three, which meant picking GST and Accounts Payable again on
   * every entity change — on the two lines where it could not have been
   * anything else.
   */
  function setBusiness(i, code) {
    setLines(ls => ls.map((l, j) => {
      if (j !== i) return l
      if (l.role === 'gst') return { ...l, business: code, account: gstRole[code] || '' }
      if (l.role === 'payable') return { ...l, business: code, account: '2100' }
      return { ...l, business: code }
    }))
  }

  const setLine = (i, k, v) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l))

  const perBiz = useMemo(() => {
    const m = {}
    for (const l of lines || []) {
      if (!l.business) continue
      const b = m[l.business] || (m[l.business] = { d: 0, c: 0 })
      b.d += num(l.debit); b.c += num(l.credit)
    }
    return m
  }, [lines])

  const offBy = Object.entries(perBiz)
    .map(([b, v]) => ({ business: b, diff: Math.round((v.d - v.c) * 100) / 100 }))
    .filter(x => x.diff !== 0)

  const usable = (lines || []).filter(l => l.business && l.account && (num(l.debit) || num(l.credit)))
  const canBook = usable.length >= 2 && offBy.length === 0

  const inv = (rows || []).find(r => r.id === sel)

  async function book() {
    setBusy('book'); setErr(''); setMsg('')
    try {
      await rpc('book_invoice', {
        p_receipt: sel,
        p_lines: usable.map(l => ({
          business: l.business,
          account: l.account,
          debit: num(l.debit),
          credit: num(l.credit),
          project: (l.projects || [])[0] || null,
        })),
      })

      // book_invoice carries ONE project per line. Write the rest of the tags
      // separately, or a line tagged with two projects silently keeps one.
      for (const l of usable) {
        if ((l.projects || []).length < 2) continue
        await rpc('tag_receipt_lines', {
          p_receipt: sel, p_business: l.business,
          p_account: l.account, p_projects: l.projects,
        })
      }

      // Where the card charge that paid this is already matched, write that
      // side now rather than leaving a payable to clear on a second visit.
      let settled = ''
      try {
        const s = await rpc('settle_matched_payment', { p_receipt: sel })
        settled = typeof s === 'string' ? s : ''
      } catch { /* never let the settle step lose the booking */ }

      setMsg(settled.trim() || 'Booked to payables.')

      // The slip that goes with this invoice is often already on file. Say so
      // now, while it is still in front of you, rather than leaving it to be
      // found in a queue later.
      try {
        const f = await rpc('invoice_followup', { p_receipt: sel })
        if (f && f.length) { setFollowup(f); setRows(rs => rs.filter(r => r.id !== sel)); setLines(null); setBusy(''); return }
      } catch { /* a suggestion must never block a booking */ }

      await load()
    } catch (e) { setErr('Refused: ' + e.message) }
    setBusy('')
  }

  async function acceptPayment(f) {
    setBusy(f.receipt_id); setErr('')
    try {
      const r = await rpc('accept_invoice_payment', {
        p_txn: f.txn_id, p_receipt: f.receipt_id,
      })
      setMsg(typeof r === 'string' ? r : 'Accepted.')
      setFollowup(fs => fs.filter(x => x.receipt_id !== f.receipt_id))
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  async function markOwnReceipt(on) {
    try {
      await rpc('set_own_receipt', { p_receipt: sel, p_flag: on })
      setRows(rs => rs.map(r => r.id === sel ? { ...r, is_own_receipt: on } : r))
    } catch (e) { setErr(e.message) }
  }

  return (
    <div className="page">
      <p className="hint">
        A document typed as an invoice with no entry against it. Booking it puts the
        expense and its GST on the books at the <b>invoice</b> date and raises a payable.
        The payment that clears the payable is a separate entry — which is why coding
        that payment as an expense would book the cost twice.
      </p>

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      {followup && followup.length > 0 && (
        <div className="note">
          <b>Booked — and there is a document already on file for it</b>
          <div className="fine">
            {followup.length === 1
              ? 'This was found against the same purchase.'
              : `${followup.length} were found against the same purchase.`}
          </div>
          <table style={{ marginTop: 6 }}>
            <tbody>
              {followup.map(f => (
                <tr key={f.receipt_id}>
                  <td style={{ width: 80 }}><span className="pill soft">{f.doc_type}</span></td>
                  <td>
                    {f.vendor}
                    <div className="muted" style={{ fontSize: 11 }}>{f.why}</div>
                  </td>
                  <td style={{ width: 96 }} className="muted">{f.doc_date}</td>
                  <td className="money" style={{ width: 100 }}>${money(f.amount)}</td>
                  <td style={{ width: 120 }} className="muted">{f.txn_ref || ''}</td>
                  <td style={{ width: 120 }}>
                    {f.storage_path && <DocLink path={f.storage_path} label="copy path" />}
                  </td>
                  <td style={{ width: 150 }}>
                    {f.txn_id && !f.has_entry && (
                      <button disabled={busy === f.receipt_id} onClick={() => acceptPayment(f)}>
                        {busy === f.receipt_id ? 'Accepting…' : 'That paid it'}
                      </button>
                    )}
                    {f.has_entry && <span className="pill soft">already posted</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="bar" style={{ margin: '8px 0 0' }}>
            <button onClick={load}>Back to the queue</button>
          </div>
        </div>
      )}

      {!rows && !err && <div className="loading">Reading…</div>}
      {rows && rows.length === 0 && !followup && (
        <div className="card">
          <div className="muted">
            No invoices waiting. Documents typed as invoice or statement with no
            entry against them appear here.
          </div>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th style={{ width: 78 }}>Type</th>
                <th style={{ width: 100 }} title="Our number. The vendor's own number is in Reference.">Doc no.</th>
                <th>Vendor</th>
                <th style={{ width: 110 }}>Reference</th>
                <th style={{ width: 92 }}>Invoiced</th>
                <th style={{ width: 92 }}>Due</th>
                <th className="num" style={{ width: 100 }}>Amount</th>
                <th className="num" style={{ width: 84 }}>GST</th>
                <th style={{ width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const creditNote = num(r.amount) < 0
                return [
                  <tr key={r.id} className={'drill' + (sel === r.id ? ' rowsel' : '')}
                      onClick={() => open(r)}>
                    <td>
                      <span className={'pill ' + (creditNote ? 'hold' : '')}>
                        {creditNote ? 'credit' : r.doc_type}
                      </span>
                    </td>
                    <td className="muted">{r.doc_no}</td>
                    <td>{r.vendor}</td>
                    <td className="muted">{r.reference}</td>
                    <td>{r.doc_date || ''}</td>
                    <td>{r.due_date || ''}</td>
                    <td className={'money ' + (creditNote ? 'neg' : '')}>
                      {creditNote ? '−' : ''}${money(Math.abs(num(r.amount)))}
                    </td>
                    <td className="money">
                      {num(r.gst) ? (num(r.gst) < 0 ? '−' : '') + '$' + money(Math.abs(num(r.gst))) : ''}
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {num(r.days_overdue) > 0 && (
                        <span className="pill hold">{r.days_overdue}d</span>
                      )}
                      {num(r.item_lines) > 0 && (
                        <span className="pill soft">{r.item_lines} lines</span>
                      )}
                      {r.storage_path && <DocLink path={r.storage_path} label="copy path" />}
                    </td>
                  </tr>,
                  sel === r.id && (
                    <tr key={r.id + '-d'} className="expand">
                      <td colSpan={9}>
                        {!lines && <div className="loading">Reading…</div>}
                        {lines && (
                          <div>
                            <div className="bar" style={{ margin: '0 0 8px' }}>
                              <b>{r.vendor}</b>
                              {r.reference && <span className="muted">{r.reference}</span>}
                              <span className="muted">
                                {r.doc_currency !== 'CAD' && `${r.doc_currency} ${money(r.doc_amount_ff)} @ ${r.doc_fx_rate} · `}
                                ${money(Math.abs(num(r.amount)))} incl. ${money(Math.abs(num(r.gst)))} GST
                              </span>
                              <span style={{ flex: 1 }} />
                              <label className="tick">
                                <input type="checkbox" checked={!!r.is_own_receipt}
                                       onChange={e => markOwnReceipt(e.target.checked)} />
                                No separate receipt to come
                              </label>
                            </div>

                            {creditNote && (
                              <div className="note warn" style={{ marginBottom: 8 }}>
                                <b>Credit note.</b> The sides are already swapped — the payable is
                                debited and the expense credited. Nothing here needs a minus sign.
                              </div>
                            )}

                            {num(r.item_lines) > 0 && (
                              <Section title="The invoice, line by line"
                                       count={`${r.item_lines} item lines`} defaultOpen>
                                <ReceiptLines txnId={null} receiptId={r.id} />
                              </Section>
                            )}

                            <table style={{ marginTop: 6 }}>
                              <thead>
                                <tr>
                                  <th style={{ width: 90 }}>Entity</th>
                                  <th>Account</th>
                                  <th className="num" style={{ width: 120 }}>Debit</th>
                                  <th className="num" style={{ width: 120 }}>Credit</th>
                                  <th style={{ width: 150 }}>Projects</th>
                                  <th style={{ width: 36 }} />
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((l, i) => (
                                  <tr key={i}>
                                    <td>
                                      <select value={l.business}
                                              onChange={e => setBusiness(i, e.target.value)}>
                                        <option value="">—</option>
                                        {entities.map(b => (
                                          <option key={b.code} value={b.code}>{b.code}</option>
                                        ))}
                                      </select>
                                    </td>
                                    <td>
                                      <select value={l.account} disabled={!l.business}
                                              style={{ width: '100%' }}
                                              onChange={e => setLine(i, 'account', e.target.value)}>
                                        <option value="">—</option>
                                        {accountsFor(l.business).map(a => (
                                          <option key={a.number} value={a.number}>
                                            {a.number} — {a.name}
                                          </option>
                                        ))}
                                        {l.account && !accountsFor(l.business).some(a => a.number === l.account) && (
                                          <option value={l.account}>{l.account} — not in this chart</option>
                                        )}
                                      </select>
                                      {l.role !== 'expense' && (
                                        <div className="muted" style={{ fontSize: 11 }}>
                                          {l.role === 'gst' ? 'GST paid — set by the entity'
                                                            : 'Accounts payable'}
                                        </div>
                                      )}
                                    </td>
                                    <td>
                                      <input type="number" step="0.01" className="num" value={l.debit}
                                             disabled={num(l.credit) > 0}
                                             onChange={e => setLine(i, 'debit', e.target.value)} />
                                    </td>
                                    <td>
                                      <input type="number" step="0.01" className="num" value={l.credit}
                                             disabled={num(l.debit) > 0}
                                             onChange={e => setLine(i, 'credit', e.target.value)} />
                                    </td>
                                    <td style={{ fontSize: 11 }}>
                                      {l.role === 'expense' ? (
                                        <div className="tickbox">
                                          {projects.map(p => {
                                            const on = (l.projects || []).includes(p.id)
                                            return (
                                              <label key={p.id} className="tick">
                                                <input type="checkbox" checked={on}
                                                       onChange={() => setLine(i, 'projects',
                                                         on ? l.projects.filter(x => x !== p.id)
                                                            : [...(l.projects || []), p.id])} />
                                                {p.name}
                                              </label>
                                            )
                                          })}
                                        </div>
                                      ) : <span className="muted">—</span>}
                                    </td>
                                    <td>
                                      {lines.length > 2 && (
                                        <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>×</button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>

                            <div className="bar" style={{ margin: '8px 0 0' }}>
                              <button onClick={() => setLines(ls => [...ls, {
                                business: ls[0]?.business || '', account: '',
                                debit: '', credit: '', role: 'expense', projects: [],
                              }])}>
                                Add a line
                              </button>
                              <button onClick={() => open(r)}>Reset</button>
                              <span style={{ flex: 1 }} />
                              {Object.entries(perBiz).map(([b, v]) => (
                                <span key={b} className="muted" style={{ fontSize: 12 }}>
                                  {b}: {money(v.d)} / {money(v.c)}
                                </span>
                              ))}
                              <button className="primary" disabled={!canBook || !!busy}
                                      onClick={book}>
                                {busy === 'book' ? 'Booking…' : 'Book it to payables'}
                              </button>
                            </div>

                            {offBy.length > 0 && (
                              <div className="note warn" style={{ marginTop: 8 }}>
                                <b>Not balanced.</b>{' '}
                                {offBy.map((x, i) => (
                                  <span key={x.business}>
                                    {i > 0 && ' · '}{x.business} is out by {money(Math.abs(x.diff))}
                                  </span>
                                ))}
                                <div className="fine">
                                  Each entity has to balance on its own, and each carries its own
                                  payable. An entry balancing only in total would quietly move
                                  money between businesses.
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
