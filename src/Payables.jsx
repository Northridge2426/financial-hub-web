import { useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money } from './format.js'
import DocLink from './DocLink.jsx'
import ReceiptLines from './ReceiptLines.jsx'
import ProjectPicker from './ProjectPicker.jsx'
import { useEntities } from './useEntities.js'

const num = v => Number(v) || 0

/**
 * One payable opened up: how it was coded, and a way to code it again.
 *
 * The page could say what was owed and nothing about where the cost went, so a
 * mistake found after the invoice left the allocation queue had no route back.
 *
 * Re-coding needs no new write path. book_invoice opens by deleting the
 * invoice's own journal lines and rewrites them, so calling it a second time
 * REPLACES the coding — and the prior-year triggers on journal_lines refuse a
 * closed period whoever asks, so there is no separate rule to keep in step
 * here. Settlement lines live on the PAYMENT and are untouched by any of it.
 */
function PayableCoding({ receiptId, onSaved }) {
  const [lines, setLines] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState([])
  const [busy, setBusy] = useState(false)
  const [accounts, setAccounts] = useState([])
  const [projects, setProjects] = useState([])
  const entities = useEntities()

  useEffect(() => {
    supabase.from('v_chart_of_accounts').select('business,number,name')
      .eq('usable', true).eq('postable', true).order('business').order('number')
      .then(({ data }) => setAccounts(data || []))
    supabase.from('projects').select('id,name').eq('active', true).order('name')
      .then(({ data }) => setProjects(data || []))
  }, [])

  const load = () => {
    setLines(null); setErr('')
    rpc('web_payable_coding', { p_receipt: receiptId })
      .then(setLines).catch(e => setErr(e.message))
  }
  useEffect(load, [receiptId])

  const setRow = (i, k, v) => setDraft(d => d.map((x, j) => j === i ? { ...x, [k]: v } : x))
  const forBiz = b => accounts.filter(a => a.business === b)

  function beginEdit() {
    setDraft((lines || []).filter(l => !l.settles).map(l => ({
      business: l.business, account: l.gl_number,
      debit: num(l.debit) || '', credit: num(l.credit) || '',
      memo: l.memo || '', projects: [],
    })))
    setEditing(true); setMsg('')
  }

  async function save() {
    setBusy(true); setErr(''); setMsg('')
    try {
      const usable = draft.filter(l => l.business && l.account && (num(l.debit) || num(l.credit)))
      if (!usable.length) throw new Error('Nothing to post — every line needs an entity, an account and a figure.')
      await rpc('book_invoice', {
        p_receipt: receiptId,
        p_lines: usable.map(l => ({
          business: l.business, account: l.account,
          debit: num(l.debit), credit: num(l.credit), memo: l.memo || null,
          project: (l.projects || [])[0] || null,
        })),
      })
      // book_invoice carries ONE project per line; the rest of the tags go on
      // separately or a line tagged twice silently keeps one.
      for (const l of usable) {
        if ((l.projects || []).length < 2) continue
        await rpc('tag_receipt_lines', {
          p_receipt: receiptId, p_business: l.business,
          p_account: l.account, p_projects: l.projects,
        })
      }
      setEditing(false); setMsg('Re-coded.'); load(); if (onSaved) onSaved()
    } catch (e) { setErr('Refused: ' + e.message) }
    setBusy(false)
  }

  if (err && !lines) return <div className="err">{err}</div>
  if (!lines) return <div className="loading">Opening…</div>

  const own = lines.filter(l => !l.settles)
  const paid = lines.filter(l => l.settles)
  const dr = draft.reduce((a, l) => a + num(l.debit), 0)
  const cr = draft.reduce((a, l) => a + num(l.credit), 0)

  return (
    <div>
      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      {!editing && (
        <>
          <table>
            <thead>
              <tr>
                <th style={{ width: 54 }}>Biz</th>
                <th style={{ width: 70 }}>Acct</th>
                <th>Account</th>
                <th>Memo</th>
                <th style={{ width: 110 }}>Project</th>
                <th style={{ width: 96 }}>Date</th>
                <th className="num" style={{ width: 100 }}>Debit</th>
                <th className="num" style={{ width: 100 }}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {own.length === 0 && (
                <tr><td colSpan={8} className="muted">
                  Not coded yet — it is a payable with no expense entry behind it.
                </td></tr>
              )}
              {own.map((l, i) => (
                <tr key={'o' + i}>
                  <td><span className="pill">{l.business}</span></td>
                  <td className="muted">{l.gl_number}</td>
                  <td>{l.gl_name}</td>
                  <td style={{ fontSize: 12 }}>{l.memo}</td>
                  <td style={{ fontSize: 12 }}>{l.project || <span className="muted">—</span>}</td>
                  <td className="muted">{l.entry_date}</td>
                  <td className="money">{num(l.debit) ? '$' + money(l.debit) : ''}</td>
                  <td className="money">{num(l.credit) ? '$' + money(l.credit) : ''}</td>
                </tr>
              ))}
              {paid.map((l, i) => (
                <tr key={'p' + i} className="muted">
                  <td><span className="pill soft">{l.business}</span></td>
                  <td className="muted">{l.gl_number}</td>
                  <td>{l.gl_name}</td>
                  <td style={{ fontSize: 12 }}>{l.memo}</td>
                  <td />
                  <td className="muted">{l.entry_date}</td>
                  <td className="money">{num(l.debit) ? '$' + money(l.debit) : ''}</td>
                  <td className="money">{num(l.credit) ? '$' + money(l.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="bar" style={{ margin: '6px 0 0' }}>
            <button className="primary" onClick={beginEdit}>Re-code this invoice</button>
            <span className="muted" style={{ fontSize: 11.5 }}>
              Replaces the invoice's own lines. Anything already paid against it
              {paid.length ? ' (the dimmed lines)' : ''} belongs to the payment and is left alone.
            </span>
          </div>
        </>
      )}

      {editing && (
        <>
          <ReceiptLines receiptId={receiptId} onBuild={built => setDraft(built.map(l => ({
            business: l.business || '', account: l.account || '',
            debit: num(l.debit) || '', credit: num(l.credit) || '',
            memo: l.basis || '', projects: l.project_ids || [],
          })))} />
          <table style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th style={{ width: 84 }}>Entity</th>
                <th style={{ width: 220 }}>Account</th>
                <th>Memo</th>
                <th style={{ width: 120 }}>Projects</th>
                <th className="num" style={{ width: 100 }}>Debit</th>
                <th className="num" style={{ width: 100 }}>Credit</th>
                <th style={{ width: 34 }} />
              </tr>
            </thead>
            <tbody>
              {draft.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select value={l.business} onChange={e => setRow(i, 'business', e.target.value)}>
                      <option value="">—</option>
                      {entities.map(b => <option key={b.code} value={b.code}>{b.code}</option>)}
                    </select>
                  </td>
                  <td>
                    <select style={{ width: '100%' }} value={l.account} disabled={!l.business}
                            onChange={e => setRow(i, 'account', e.target.value)}>
                      <option value="">—</option>
                      {forBiz(l.business).map(a => (
                        <option key={a.number} value={a.number}>{a.number} — {a.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input value={l.memo} style={{ width: '100%' }}
                           onChange={e => setRow(i, 'memo', e.target.value)} />
                  </td>
                  <td>
                    <ProjectPicker value={l.projects} projects={projects}
                                   onChange={v => setRow(i, 'projects', v)} />
                  </td>
                  <td>
                    <input className="num" inputMode="decimal" value={l.debit}
                           onChange={e => setRow(i, 'debit', e.target.value)} />
                  </td>
                  <td>
                    <input className="num" inputMode="decimal" value={l.credit}
                           onChange={e => setRow(i, 'credit', e.target.value)} />
                  </td>
                  <td>
                    <button onClick={() => setDraft(d => d.filter((_, j) => j !== i))}>×</button>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} className="muted" style={{ textAlign: 'right' }}>
                  <b>{Math.abs(dr - cr) < 0.005 ? 'balances' : 'OUT BY ' + money(dr - cr)}</b>
                </td>
                <td className="money"><b>${money(dr)}</b></td>
                <td className="money"><b>${money(cr)}</b></td>
                <td />
              </tr>
            </tbody>
          </table>
          <div className="bar" style={{ margin: '6px 0 0' }}>
            <button onClick={() => setDraft(d => [...d, { business: '', account: '', debit: '', credit: '', memo: '', projects: [] }])}>
              Add a line
            </button>
            <span style={{ flex: 1 }} />
            <button onClick={() => { setEditing(false); setDraft([]) }}>Cancel</button>
            <button className="primary" disabled={busy || Math.abs(dr - cr) > 0.005}
                    title={Math.abs(dr - cr) > 0.005 ? 'The two sides have to agree first.' : ''}
                    onClick={save}>
              {busy ? 'Saving…' : 'Save the coding'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Outstanding payables — invoices booked to payables and not yet cleared.
 *
 * Reads two views rather than functions. Both are `security_invoker`, so they
 * apply RLS to the caller instead of the view owner — a signed-in user sees
 * exactly what the policies allow.
 *
 * `v_ap_outstanding` has no foreign key PostgREST can follow to `receipts`
 * (views don't carry them), so `doc_no` is fetched separately and joined here
 * by receipt_id. Two small queries beat one that cannot be expressed.
 */
export default function Payables() {
  const [rows, setRows] = useState(null)
  const [control, setControl] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [linking, setLinking] = useState(false)
  const [payJno, setPayJno] = useState('')
  const [invJno, setInvJno] = useState('')
  const [allowDiff, setAllowDiff] = useState(false)
  const [open, setOpen] = useState(null)   // receipt_id of the row showing its coding

  // named so re-coding an invoice can refresh the balances without a full page
  // reload, which would also close the row you are looking at
  const reload = async () => {
      try {
        const [ap, ctl] = await Promise.all([
          supabase.from('v_ap_outstanding')
            .select('business,receipt_id,doc_vendor,doc_reference,doc_date,due_date,balance,days_overdue,storage_path')
            .order('business').order('doc_date'),
          supabase.from('v_open_items_vs_control')
            .select('business,control_date,ap_per_sage,open_items_here,items,difference')
            .order('business'),
        ])
        if (ap.error) throw new Error(ap.error.message)
        if (ctl.error) throw new Error(ctl.error.message)

        const ids = [...new Set((ap.data || []).map(r => r.receipt_id))]
        let docNo = {}
        if (ids.length) {
          const { data } = await supabase.from('receipts').select('id,doc_no').in('id', ids)
          docNo = Object.fromEntries((data || []).map(r => [r.id, r.doc_no || '']))
        }
        setRows((ap.data || []).map(r => ({ ...r, doc_no: docNo[r.receipt_id] || '' })))
        setControl(ctl.data || [])
      } catch (e) { setErr(e.message) }
  }

  useEffect(() => { reload() }, [])

  if (err) return <div className="page"><div className="err">{err}</div></div>
  if (!rows) return <div className="page"><div className="loading">Reading…</div></div>

  const total = rows.reduce((a, r) => a + Number(r.balance || 0), 0)
  const overdue = rows.filter(r => Number(r.days_overdue) > 0)
  const offBy = control.filter(c => Math.abs(Number(c.difference)) > 0.01)

  /**
   * Repair: a payment posted here and an invoice posted here that nobody joined.
   *
   * link_ap_payment has TWO overloads differing only by p_allow_difference, and
   * PostgREST resolves by argument NAME — so omitting it is ambiguous, not
   * defaulted. It is always sent.
   */
  async function link() {
    setBusy(true); setErr(''); setMsg('')
    try {
      const res = await rpc('link_ap_payment', {
        p_payment_jno: payJno.trim(),
        p_invoice_jno: invJno.trim(),
        p_business: null,
        p_allow_difference: allowDiff,
      })
      setMsg(typeof res === 'string' ? res : 'Linked.')
      setPayJno(''); setInvJno(''); setAllowDiff(false); setLinking(false)
      window.location.reload()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="page">
      <p className="hint">
        Invoices booked to payables and not yet cleared by a payment. The total should agree with
        account 2100 in the trial balance — a list nobody reconciles is a guess.
      </p>

      <div className="grid" style={{ marginBottom: 14 }}>
        <div className="stat"><div className="n">{rows.length}</div><div className="l">open invoices</div></div>
        <div className="stat"><div className="n neg">${money(total)}</div><div className="l">outstanding</div></div>
        <div className="stat">
          <div className={'n ' + (overdue.length ? 'warn' : 'pos')}>{overdue.length}</div>
          <div className="l">past their due date</div>
        </div>
        <div className="stat">
          <div className={'n ' + (offBy.length ? 'warn' : 'pos')}>{offBy.length}</div>
          <div className="l">entities off the control</div>
        </div>
      </div>

      {msg && <div className="note good">{msg}</div>}
      {err && <div className="err">{err}</div>}

      <div className="bar">
        <span className="muted" style={{ fontSize: 12 }}>
          An invoice that is in fact paid, but whose payment entry nobody joined to it, sits here
          forever.
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={() => setLinking(l => !l)}>
          {linking ? 'Cancel' : 'Link a payment to an invoice'}
        </button>
      </div>

      {linking && (
        <div className="card">
          <h2>Join two entries that are already posted</h2>
          <div className="bar" style={{ margin: 0 }}>
            <label htmlFor="apPay">Payment entry</label>
            <input id="apPay" value={payJno} placeholder="its journal number" style={{ width: 170 }}
                   onChange={e => setPayJno(e.target.value)} />
            <label htmlFor="apInv">settles invoice</label>
            <input id="apInv" value={invJno} placeholder="its journal number" style={{ width: 170 }}
                   onChange={e => setInvJno(e.target.value)} />
            <label className="tick"
                   title="Only if the payment and the invoice genuinely differ — a discount taken, a short payment. Otherwise a mismatch means one of the two numbers is wrong.">
              <input type="checkbox" checked={allowDiff}
                     onChange={e => setAllowDiff(e.target.checked)} />
              The amounts differ, and that is correct
            </label>
            <button className="primary" disabled={!payJno.trim() || !invJno.trim() || busy}
                    onClick={link}>
              {busy ? 'Linking…' : 'Link them'}
            </button>
          </div>
          <p className="hint" style={{ margin: '6px 0 0' }}>
            This posts nothing. It stamps the settlement that marks the invoice paid — the stamp
            both entries were missing.
          </p>
        </div>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th style={{ width: 70 }}>Entity</th>
              <th style={{ width: 96 }} title="Our number. The vendor's own number is in Reference.">Doc no.</th>
              <th>Vendor</th>
              <th style={{ width: 130 }}>Reference</th>
              <th style={{ width: 100 }}>Invoice</th>
              <th style={{ width: 100 }}>Due</th>
              <th className="num" style={{ width: 110 }}>Balance</th>
              <th style={{ width: 82 }}>Overdue</th>
              <th style={{ width: 70 }} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} className="muted">
                Nothing outstanding. Invoices appear here once booked to payables.
              </td></tr>
            )}
            {rows.flatMap(r => {
              // One document can be payable by more than one entity — a GST return is
              // split between BRA and BMS — so the document alone is not a unique row.
              // A shared key made React draw one entity's row twice and drop the other.
              const key = r.receipt_id + '|' + r.business + '|' + r.doc_date
              const shown = open === key
              return [
                <tr key={key} className={'drill' + (shown ? ' rowsel' : '')}
                    onClick={() => setOpen(shown ? null : key)}>
                  <td><span className="pill">{r.business}</span></td>
                  <td className="muted">{r.doc_no}</td>
                  <td>
                    {r.doc_vendor || '—'}
                    {/* the link must not also toggle the row */}
                    <span onClick={e => e.stopPropagation()}>
                      {r.storage_path && <DocLink path={r.storage_path} label="invoice" />}
                    </span>
                  </td>
                  <td className="muted">{r.doc_reference || ''}</td>
                  <td>{r.doc_date || ''}</td>
                  <td>{r.due_date || ''}</td>
                  <td className="money">${money(r.balance)}</td>
                  <td>
                    {Number(r.days_overdue) > 0 &&
                      <span className="pill hold">{r.days_overdue}d</span>}
                  </td>
                  <td className="muted" style={{ fontSize: 11 }}>
                    {shown ? 'hide' : 'coding'}
                  </td>
                </tr>,
                shown && (
                  <tr key={key + '-c'} className="expand">
                    <td colSpan={9} onClick={e => e.stopPropagation()}>
                      <PayableCoding receiptId={r.receipt_id} onSaved={reload} />
                    </td>
                  </tr>
                ),
              ]
            })}
            {rows.length > 0 && (
              <tr className="total">
                <td colSpan={6}>Total outstanding</td>
                <td className="money">${money(total)}</td>
                <td colSpan={2} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Against the control account</h2>
        <table>
          <thead>
            <tr>
              <th>Entity</th>
              <th style={{ width: 100 }}>As at</th>
              <th className="num" style={{ width: 130 }}>2100 per Sage</th>
              <th className="num" style={{ width: 130 }}>Listed here</th>
              <th className="num" style={{ width: 70 }}>Items</th>
              <th className="num" style={{ width: 130 }}>Difference</th>
            </tr>
          </thead>
          <tbody>
            {control.map(c => {
              const off = Math.abs(Number(c.difference)) > 0.01
              return (
                <tr key={c.business}>
                  <td><span className="pill">{c.business}</span></td>
                  <td>{c.control_date || '—'}</td>
                  <td className="money">${money(c.ap_per_sage)}</td>
                  <td className="money">${money(c.open_items_here)}</td>
                  <td className="money">{c.items}</td>
                  <td className={'money ' + (off ? 'due-soon' : '')}>${money(c.difference)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          A difference means invoices behind the Sage balance have not been entered here yet — or,
          where it runs the other way, that invoices are open here which Sage has already cleared.
        </p>
      </div>
    </div>
  )
}
