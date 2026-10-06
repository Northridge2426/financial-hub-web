import { useCallback, useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money } from './format.js'
import { useEntities } from './useEntities.js'

const num = v => Number(v) || 0

/**
 * Reading a receipt line by line and coding each line.
 *
 * Coding is saved the moment you change it, not held in the page. Twenty
 * hand-annotated items get read over more than one sitting, and a correction
 * that vanishes on reload is worse than no correction at all — that is the
 * console's reasoning and it is right.
 *
 * A split changes the SHAPE of the list rather than one field, so it is read
 * back from the database rather than patched in the page.
 */
export default function ReceiptLines({ txnId, receiptId, onBuild }) {
  const [receipts, setReceipts] = useState(null)
  const [lines, setLines] = useState({})          // receipt_id -> rows
  const [accounts, setAccounts] = useState([])
  const [projects, setProjects] = useState([])
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [splitting, setSplitting] = useState(null)
  const [parts, setParts] = useState([])
  const [voiding, setVoiding] = useState(null)   // receipt awaiting a reason
  const [voidWhy, setVoidWhy] = useState('')
  const [fx, setFx] = useState(null)             // receipt whose currency is being set
  const [fxCur, setFxCur] = useState('USD')
  const [fxAmt, setFxAmt] = useState('')
  const [fxGst, setFxGst] = useState('')
  // A line is coded by TWO fields and set_receipt_line needs both at once, so a
  // half-made choice has to live here until it is complete. Without this the
  // entity select called code() with a null account, which returned silently,
  // and the account select stayed disabled waiting for an entity that could
  // never be saved — neither field could go first.
  const [pending, setPending] = useState({})     // line_id -> { business, account }
  const [picker, setPicker] = useState(null)     // { line, rid, top, left }
  const [adding, setAdding] = useState(null)     // receipt gaining a line
  const [newLine, setNewLine] = useState({ desc: '', amt: '' })
  const entities = useEntities()

  useEffect(() => {
    supabase.from('v_chart_of_accounts').select('business,number,name')
      .eq('usable', true).eq('postable', true).order('business').order('number')
      .then(({ data }) => setAccounts(data || []))
    supabase.from('projects').select('id,name').eq('active', true).order('name')
      .then(({ data }) => setProjects(data || []))
  }, [])

  const loadLines = useCallback(async rid => {
    try {
      const rows = await rpc('web_receipt_lines', { p_receipt: rid })
      setLines(l => ({ ...l, [rid]: rows }))
    } catch (e) { setErr(e.message) }
  }, [])

  /**
   * Two ways in: every receipt on a transaction, or one named document. The
   * invoice queue uses the second — an invoice has its item lines before any
   * bank line exists to attach it to.
   *
   * Read `receipts` directly. This used to go through `v_receipt_stubs`, which
   * is `storage_path is null AND file_sha256 is null` — the "recorded from an
   * email, no file behind it" view. Every receipt that HAS a file was therefore
   * excluded, which was all 257 of them: this editor showed nothing, anywhere,
   * from the day it was ported. The view answers a different question and was
   * filtered by receipt_id without anyone checking what it leaves out.
   */
  const load = useCallback(async () => {
    setErr('')
    const cols = 'receipt_id:id,doc_vendor,doc_date,doc_amount,doc_type,doc_reference,storage_path'
    const qy = supabase.from('receipts').select(cols)
    const { data, error } = await (receiptId
      ? qy.eq('id', receiptId)
      : qy.eq('transaction_id', txnId))
    if (error) { setErr(error.message); return }

    setReceipts(data || [])
    for (const r of data || []) loadLines(r.receipt_id)
  }, [txnId, receiptId, loadLines])

  useEffect(() => { load() }, [load])

  /**
   * Hold the half-made choice, and write only when the pair is complete.
   * `set_receipt_line` takes a business AND an account; there is no way to
   * save one on its own.
   */
  function choose(rid, line, patch) {
    const next = { ...(pending[line.line_id] || {}), ...patch }
    setPending(p => ({ ...p, [line.line_id]: next }))
    const business = next.business ?? line.business
    const account = next.account ?? line.gl_number
    if (business && account) code(rid, line, business, account)
  }

  async function code(rid, line, business, account) {
    if (!business || !account) return
    setBusy(line.line_id); setErr(''); setMsg('')
    try {
      await rpc('set_receipt_line', {
        p_line_id: line.line_id, p_business_code: business, p_account_number: account,
      })
      setPending(p => { const n = { ...p }; delete n[line.line_id]; return n })
      await loadLines(rid)
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  /**
   * Fill down, twice over.
   *
   * An invoice arrives with its items GROUPED — toys, then treats, then food —
   * so the real pattern is: code the first line, fill the lot, then part way
   * down change a line and re-fill from there. The second fill has to OVERWRITE
   * what the first one wrote, and `p_only_blank: true` could not: it found
   * nothing blank and reported "filled 0".
   *
   * `onlyBlank` false is the same function with its other argument — the
   * database always supported this; only the button did not offer it.
   */
  /**
   * Roll the coded lines up into an entry.
   *
   * `web_lines_to_entry` does the grouping, the one-GST-line-per-business rule
   * and the payable or card side — in SQL, because the console does the same
   * thing in JavaScript and a second copy in React is how the two drift apart.
   * It refuses an uncoded leaf or a split that no longer adds back, rather than
   * quietly landing the cost on whoever paid.
   */
  async function build(rid) {
    setBusy('build-' + rid); setErr(''); setMsg('')
    try {
      const lines = await rpc('web_lines_to_entry', {
        p_receipt: rid, p_txn: txnId || null,
      })
      if (!lines.length) { setErr('Nothing to build — no coded lines on this document.'); setBusy(''); return }
      onBuild(lines)
      setMsg(`Built ${lines.length} entry line${lines.length === 1 ? '' : 's'} from the document. `
           + 'Check it in Entry below, then save.')
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  /**
   * Append a line to the document. The reason this exists is the gratuity: a
   * restaurant receipt prints the meal, the card takes the meal plus the tip,
   * and nothing on paper records the difference. web_lines_entry_check now
   * refuses to build an entry whose lines do not add up to what the bank took,
   * so there has to be a way to put the missing cost on the document.
   *
   * GST is zero and gst_bearing false: a tip is not consideration for a supply.
   */
  async function addLine(rid) {
    setBusy('addline-' + rid); setErr(''); setMsg('')
    try {
      await rpc('web_add_receipt_line', {
        p_receipt: rid,
        p_description: newLine.desc.trim(),
        p_amount: Number(newLine.amt),
        p_gst: 0,
        p_gst_bearing: false,
      })
      setAdding(null); setNewLine({ desc: '', amt: '' })
      await loadLines(rid)
      setMsg('Line added, uncoded. Code it with the others.')
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  async function fillDown(rid, line, onlyBlank = true) {
    setBusy(line.line_id); setErr(''); setMsg('')
    try {
      const out = await rpc('fill_receipt_lines_down', {
        p_line: line.line_id, p_only_blank: onlyBlank,
      })
      const r = (out && out[0]) || {}
      const n = r.filled ?? 0
      setMsg(n === 0
        ? (onlyBlank
            ? 'Nothing below this line is blank. Use "replace below" to overwrite the coding.'
            : 'Nothing below this line to fill.')
        : `${onlyBlank ? 'Filled' : 'Replaced'} ${n} line${n === 1 ? '' : 's'} with ${r.business} ${r.account}`
          + (r.skipped ? `, skipped ${r.skipped}.` : '.'))
      await loadLines(rid)
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  async function setLineProjects(rid, line, ids) {
    setBusy(line.line_id); setErr('')
    try {
      await rpc('set_receipt_line_projects', { p_line: line.line_id, p_projects: ids })
      await loadLines(rid)
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  function beginSplit(line) {
    setSplitting(line.line_id)
    // the first part inherits whatever the line was already coded to, so a
    // two-way split of an already-coded line only needs the second side filled
    setParts([
      { business: line.business || '', pct: 50, account: line.gl_number || '' },
      { business: '', pct: 50, account: '' },
    ])
  }

  /**
   * `set_split_parts` rather than `split_receipt_line`: it REPLACES the split
   * rather than only creating one, so the same control edits an existing split
   * and an empty list undoes it. It also keeps the accounts already chosen on
   * the parts it rebuilds, and reports whether the result balances.
   */
  async function doSplit(rid, line, clear = false) {
    setBusy(line.line_id); setErr(''); setMsg('')
    try {
      const payload = clear ? [] : parts
        .filter(p => p.business && num(p.pct) > 0)
        .map(p => ({ business: p.business, pct: num(p.pct), account: p.account || null }))
      const res = await rpc('set_split_parts', { p_line_id: line.line_id, p_parts: payload })
      setSplitting(null); setParts([])
      await loadLines(rid)          // the shape changed — read it back
      const uncoded = clear ? 0 : payload.filter(p => !p.account).length
      if (clear) setMsg('Split undone — back to one line.')
      else if (res && res.length && res.some(x => x.balanced === false)) {
        setMsg('Split saved, but the parts do not add back to the line. Check the percentages.')
      } else setMsg(uncoded
        ? `Split. ${uncoded} part${uncoded === 1 ? '' : 's'} still need an account.`
        : 'Split, and every part is coded.')
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  /**
   * Voiding a document.
   *
   * The refusal that matters lives in `void_document`: it will not void
   * anything with journal lines posted against it, because the ledger would
   * then say something the document no longer supports. That check is in the
   * function, not here.
   */
  async function voidDoc(rid) {
    setBusy(rid); setErr(''); setMsg('')
    try {
      const res = await rpc('void_document', { p_receipt: rid, p_reason: voidWhy.trim() || null })
      setMsg(typeof res === 'string' ? res : 'Voided.')
      setVoiding(null); setVoidWhy('')
      await load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  /**
   * A foreign-currency document. The figures on the paper are the foreign ones;
   * what the books carry is the converted amount. Recording the original here
   * is what makes the rate auditable later instead of a number nobody can
   * reproduce.
   */
  async function setCurrency(rid) {
    setBusy(rid); setErr(''); setMsg('')
    try {
      const res = await rpc('set_document_currency', {
        p_receipt: rid,
        p_currency: fxCur,
        p_amount_ff: fxAmt === '' ? null : num(fxAmt),
        p_gst_ff: fxGst === '' ? null : num(fxGst),
      })
      setMsg(typeof res === 'string' ? res : 'Currency recorded.')
      setFx(null); setFxAmt(''); setFxGst('')
      await load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  const accountsFor = biz => accounts.filter(a => a.business === biz)
  const pctTotal = parts.reduce((a, p) => a + num(p.pct), 0)

  if (!receipts) return <div className="loading">Reading documents…</div>
  if (receipts.length === 0) return null

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Positioned `fixed` from the button's own rect: a table cell clips an
          absolutely-positioned pop-up, which is a trap this project has hit
          before. One panel, moved, rather than one per row. */}
      {picker && (
        <>
          <div className="pickveil" onClick={() => setPicker(null)} />
          <div className="projpick" style={{ top: picker.top, left: picker.left }}>
            {projects.length === 0 && <div className="muted">No active projects.</div>}
            {projects.map(p => {
              const on = (picker.line.project_ids || []).includes(p.id)
              return (
                <label key={p.id} className="tick">
                  <input type="checkbox" checked={on}
                         onChange={() => {
                           const next = on
                             ? (picker.line.project_ids || []).filter(x => x !== p.id)
                             : [...(picker.line.project_ids || []), p.id]
                           setLineProjects(picker.rid, picker.line, next)
                           setPicker(pk => pk && ({ ...pk,
                             line: { ...pk.line, project_ids: next } }))
                         }} />
                  {p.name}
                </label>
              )
            })}
            <div className="bar" style={{ margin: '6px 0 0', padding: 0 }}>
              <button onClick={() => setPicker(null)}>Done</button>
            </div>
          </div>
        </>
      )}

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      {receipts.map(r => {
        const rows = lines[r.receipt_id]
        const uncoded = (rows || []).filter(l => !l.gl_number).length
        return (
          <div className="note" key={r.receipt_id} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <b>{r.doc_vendor || r.doc_type}</b>
              {r.doc_reference && <span className="muted">{r.doc_reference}</span>}
              <span className="muted">{r.doc_date}</span>
              <span className="muted">${money(r.doc_amount)}</span>
              <span style={{ flex: 1 }} />
              {rows && (uncoded
                ? <span className="pill hold">{uncoded} line{uncoded === 1 ? '' : 's'} uncoded</span>
                : <span className="pill soft">all coded</span>)}
              <button style={{ padding: '1px 8px', fontSize: 11 }}
                      title="Record what the paper is actually in. The books keep the converted amount; this is what makes the rate reproducible later."
                      onClick={() => { setFx(fx === r.receipt_id ? null : r.receipt_id); setFxAmt(''); setFxGst('') }}>
                {fx === r.receipt_id ? 'cancel' : 'currency…'}
              </button>
              <button style={{ padding: '1px 8px', fontSize: 11 }}
                      title="Takes the document out of every queue. Refused if anything is posted against it."
                      onClick={() => { setVoiding(voiding === r.receipt_id ? null : r.receipt_id); setVoidWhy('') }}>
                {voiding === r.receipt_id ? 'cancel' : 'void…'}
              </button>
            </div>

            {fx === r.receipt_id && (
              <div className="bar" style={{ margin: '6px 0 0' }}>
                <span style={{ fontSize: 12.5 }}>The document is in</span>
                <select value={fxCur} onChange={e => setFxCur(e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="CAD">CAD — it is not foreign</option>
                </select>
                <label>Amount</label>
                <input type="number" step="0.01" value={fxAmt} style={{ width: 120 }}
                       onChange={e => setFxAmt(e.target.value)} placeholder="on the paper" />
                <label>GST</label>
                <input type="number" step="0.01" value={fxGst} style={{ width: 110 }}
                       onChange={e => setFxGst(e.target.value)} placeholder="optional" />
                <button className="primary" disabled={busy === r.receipt_id}
                        onClick={() => setCurrency(r.receipt_id)}>
                  {busy === r.receipt_id ? 'Saving…' : 'Record it'}
                </button>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  The rate comes from the converted amount already on the books.
                </span>
              </div>
            )}

            {voiding === r.receipt_id && (
              <div className="bar" style={{ margin: '6px 0 0' }}>
                <span style={{ fontSize: 12.5 }}>Why is this being voided?</span>
                <input value={voidWhy} onChange={e => setVoidWhy(e.target.value)}
                       placeholder="e.g. a duplicate of the invoice already booked"
                       style={{ flex: 1, minWidth: 240 }}
                       onKeyDown={e => { if (e.key === 'Enter') voidDoc(r.receipt_id) }} />
                <button disabled={busy === r.receipt_id} onClick={() => voidDoc(r.receipt_id)}>
                  {busy === r.receipt_id ? 'Voiding…' : 'Void it'}
                </button>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  Refused if anything is posted against it — reverse the entry first.
                </span>
              </div>
            )}

            {!rows && <div className="loading">Reading the lines…</div>}

            {rows && rows.length === 0 && (
              <div className="muted" style={{ marginTop: 4 }}>
                No lines read off this document yet.
              </div>
            )}

            {rows && rows.length > 0 && (
              <table style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>#</th>
                    <th>Item</th>
                    <th className="num" style={{ width: 90 }}>Amount</th>
                    <th style={{ width: 84 }}>Entity</th>
                    <th style={{ width: 230 }}>Account</th>
                    <th style={{ width: 150 }}>Projects</th>
                    <th style={{ width: 130 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(l => [
                    <tr key={l.line_id} className={!l.gl_number ? 'row-late' : ''}>
                      <td className="muted">
                        {l.line_no}
                        {l.parent_line_id && (
                          <div className="muted" title="Part of a split line.">↳</div>
                        )}
                      </td>
                      <td>
                        {l.description}
                        {num(l.split_pct) > 0 && (
                          <span className="pill">{Number(l.split_pct).toFixed(0)}%</span>
                        )}
                        {l.annotation && (
                          <div className="muted" style={{ fontSize: 11 }}>{l.annotation}</div>
                        )}
                      </td>
                      <td className="money">
                        ${money(l.amount)}
                        {l.gst_bearing && num(l.gst_amount) > 0 && (
                          <div className="muted" style={{ fontSize: 10.5 }}>
                            GST {money(l.gst_amount)}
                          </div>
                        )}
                      </td>
                      <td>
                        <select disabled={busy === l.line_id}
                                value={pending[l.line_id]?.business ?? l.business ?? ''}
                                onChange={e => choose(r.receipt_id, l, { business: e.target.value })}>
                          <option value="">—</option>
                          {entities.map(b => <option key={b.code} value={b.code}>{b.code}</option>)}
                        </select>
                      </td>
                      <td>
                        <select style={{ width: '100%' }}
                                value={pending[l.line_id]?.account ?? l.gl_number ?? ''}
                                disabled={!(pending[l.line_id]?.business ?? l.business) || busy === l.line_id}
                                onChange={e => choose(r.receipt_id, l, { account: e.target.value })}>
                          <option value="">—</option>
                          {accountsFor(pending[l.line_id]?.business ?? l.business).map(a => (
                            <option key={a.number} value={a.number}>{a.number} — {a.name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {/* A tick list per row ran to the height of the project
                            list on every one of nineteen lines. The picker opens
                            only when it is wanted. */}
                        <button className="projbtn" disabled={busy === l.line_id}
                                title={(l.project_ids || []).length
                                  ? projects.filter(p => (l.project_ids || []).includes(p.id))
                                            .map(p => p.name).join(', ')
                                  : 'No project on this line'}
                                onClick={e => {
                                  const b = e.currentTarget.getBoundingClientRect()
                                  setPicker(picker && picker.lineId === l.line_id
                                    ? null
                                    : { lineId: l.line_id, rid: r.receipt_id, line: l,
                                        top: b.bottom + 2, left: b.left })
                                }}>
                          {(l.project_ids || []).length
                            ? `${(l.project_ids || []).length} project${(l.project_ids || []).length === 1 ? '' : 's'}`
                            : 'projects'} <span className="caret">▾</span>
                        </button>
                      </td>
                      <td style={{ fontSize: 11 }}>
                        <button disabled={!l.gl_number || busy === l.line_id}
                                title="Copy this line's coding onto every BLANK line below it. Lines already coded are left alone."
                                onClick={() => fillDown(r.receipt_id, l, true)}>
                          fill down
                        </button>{' '}
                        <button disabled={!l.gl_number || busy === l.line_id}
                                title="Copy this line's coding onto EVERY line below it, overwriting what is already there. For when the items change category part way down."
                                onClick={() => fillDown(r.receipt_id, l, false)}>
                          replace below
                        </button>{' '}
                        <button disabled={busy === l.line_id || !!l.parent_line_id}
                                title="Divide this line between entities by percentage. Opening it again edits or undoes the split."
                                onClick={() => beginSplit(l)}>
                          split
                        </button>
                      </td>
                    </tr>,

                    splitting === l.line_id && (
                      <tr key={l.line_id + '-s'} className="expand">
                        <td colSpan={7}>
                          <b style={{ fontSize: 12.5 }}>Split ${money(l.amount)}</b>
                          <table style={{ marginTop: 4 }}>
                            <tbody>
                              {parts.map((p, i) => (
                                <tr key={i}>
                                  <td style={{ width: 100 }}>
                                    <select value={p.business}
                                            onChange={e => setParts(ps => ps.map((x, j) =>
                                              j === i ? { ...x, business: e.target.value } : x))}>
                                      <option value="">—</option>
                                      {entities.map(b => (
                                        <option key={b.code} value={b.code}>{b.code}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td style={{ width: 110 }}>
                                    <input type="number" step="0.01" className="num" value={p.pct}
                                           onChange={e => setParts(ps => ps.map((x, j) =>
                                             j === i ? { ...x, pct: e.target.value } : x))} />
                                  </td>
                                  <td className="muted" style={{ width: 120 }}>
                                    % · ${money(num(l.amount) * num(p.pct) / 100)}
                                  </td>
                                  {/* set_split_parts has always read an
                                      "account" off each part and resolved it
                                      against gl_accounts; the pane simply never
                                      sent one, so every part came out uncoded
                                      and had to be given an account by hand
                                      afterwards. The list is filtered to the
                                      part's own entity, so you cannot put a BRA
                                      cost on an FSK account. */}
                                  <td>
                                    <select value={p.account || ''}
                                            disabled={!p.business}
                                            title={p.business
                                              ? 'Which account this share goes to'
                                              : 'Pick the entity first'}
                                            onChange={e => setParts(ps => ps.map((x, j) =>
                                              j === i ? { ...x, account: e.target.value } : x))}>
                                      <option value="">
                                        {p.business ? '— leave uncoded —' : '— pick an entity —'}
                                      </option>
                                      {accounts.filter(a => a.business === p.business).map(a => (
                                        <option key={a.business + a.number} value={a.number}>
                                          {a.number} {a.name}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td style={{ width: 40 }}>
                                    {parts.length > 2 && (
                                      <button onClick={() => setParts(ps => ps.filter((_, j) => j !== i))}>×</button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="bar" style={{ margin: '6px 0 0' }}>
                            <button onClick={() => setParts(ps => [...ps, { business: '', pct: 0, account: '' }])}>
                              Add a part
                            </button>
                            <span className={'muted ' + (Math.abs(pctTotal - 100) < 0.005 ? 'pos' : 'neg')}
                                  style={{ fontSize: 12 }}>
                              {pctTotal.toFixed(2)}%
                            </span>
                            <span style={{ flex: 1 }} />
                            <button onClick={() => { setSplitting(null); setParts([]) }}>Cancel</button>
                            {num(l.split_pct) > 0 || rows.some(x => x.parent_line_id === l.line_id) ? (
                              <button disabled={busy === l.line_id}
                                      title="Removes the parts and puts the line back as it was."
                                      onClick={() => doSplit(r.receipt_id, l, true)}>
                                Undo the split
                              </button>
                            ) : null}
                            <button className="primary"
                                    disabled={Math.abs(pctTotal - 100) > 0.005 || busy === l.line_id}
                                    onClick={() => doSplit(r.receipt_id, l)}>
                              {busy === l.line_id ? 'Saving…' : 'Split it'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ),
                  ])}
                </tbody>
              </table>
            )}

            {/* A cost the printed receipt does not carry — a tip is the usual
                one. The build refuses when the lines do not add up to what the
                bank took, and this is how you close that gap. GST is left at
                zero: a gratuity is not consideration for a supply, so putting
                it on a tip would inflate the recoverable tax. */}
            {rows && rows.length > 0 && (
              <div className="bar" style={{ margin: '8px 0 0' }}>
                {adding === r.receipt_id ? (
                  <>
                    <input placeholder="what it was (e.g. Gratuity)"
                           value={newLine.desc} style={{ width: 240 }}
                           onChange={e => setNewLine(n => ({ ...n, desc: e.target.value }))} />
                    <input placeholder="amount" inputMode="decimal"
                           value={newLine.amt} style={{ width: 90 }}
                           onChange={e => setNewLine(n => ({ ...n, amt: e.target.value }))} />
                    <button className="primary"
                            disabled={!newLine.desc.trim() || !Number(newLine.amt)
                                      || busy === 'addline-' + r.receipt_id}
                            onClick={() => addLine(r.receipt_id)}>
                      {busy === 'addline-' + r.receipt_id ? 'Adding…' : 'Add the line'}
                    </button>
                    <button onClick={() => { setAdding(null); setNewLine({ desc: '', amt: '' }) }}>
                      Cancel
                    </button>
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      Added uncoded, with no GST. Code it with the others — fill down will
                      put it on the same account.
                    </span>
                  </>
                ) : (
                  <button onClick={() => setAdding(r.receipt_id)}>add a line</button>
                )}
              </div>
            )}

            {rows && rows.length > 0 && onBuild && (
              <div className="bar" style={{ margin: '8px 0 0' }}>
                <button className="primary" disabled={busy === 'build-' + r.receipt_id}
                        onClick={() => build(r.receipt_id)}>
                  {busy === 'build-' + r.receipt_id
                    ? 'Building…' : 'Build the entry from these lines'}
                </button>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  Groups the lines by entity and account, adds one GST line per entity, and puts
                  the payable on the other side. Nothing is posted until you save the entry.
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
