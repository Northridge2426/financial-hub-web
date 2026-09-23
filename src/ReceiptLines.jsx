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
export default function ReceiptLines({ txnId, receiptId }) {
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

  // Two ways in: every receipt on a transaction, or one named document. The
  // invoice queue uses the second — an invoice has its item lines before any
  // bank line exists to attach it to.
  const load = useCallback(async () => {
    setErr('')
    const qy = supabase.from('v_receipt_stubs')
      .select('receipt_id,doc_vendor,doc_date,doc_amount,doc_type,doc_reference')
    const { data, error } = await (receiptId
      ? qy.eq('receipt_id', receiptId)
      : qy.eq('transaction_id', txnId))
    if (error) { setErr(error.message); return }

    // storage_path is on receipts, not on the stub view.
    let paths = {}
    if ((data || []).length) {
      const { data: rs } = await supabase.from('receipts')
        .select('id,storage_path').in('id', data.map(r => r.receipt_id))
      paths = Object.fromEntries((rs || []).map(r => [r.id, r.storage_path]))
    }
    setReceipts((data || []).map(r => ({ ...r, storage_path: paths[r.receipt_id] || null })))
    for (const r of data || []) loadLines(r.receipt_id)
  }, [txnId, receiptId, loadLines])

  useEffect(() => { load() }, [load])

  async function code(rid, line, business, account) {
    if (!business || !account) return
    setBusy(line.line_id); setErr(''); setMsg('')
    try {
      await rpc('set_receipt_line', {
        p_line_id: line.line_id, p_business_code: business, p_account_number: account,
      })
      await loadLines(rid)
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  async function fillDown(rid, line) {
    setBusy(line.line_id); setErr(''); setMsg('')
    try {
      const out = await rpc('fill_receipt_lines_down', { p_line: line.line_id, p_only_blank: true })
      const r = (out && out[0]) || {}
      setMsg(`Filled ${r.filled ?? 0} line${r.filled === 1 ? '' : 's'} with ${r.business} ${r.account}` +
             (r.skipped ? `, skipped ${r.skipped} already coded.` : '.'))
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
    setParts([
      { business: line.business || '', pct: 50 },
      { business: '', pct: 50 },
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
        .map(p => ({ business: p.business, pct: num(p.pct) }))
      const res = await rpc('set_split_parts', { p_line_id: line.line_id, p_parts: payload })
      setSplitting(null); setParts([])
      await loadLines(rid)          // the shape changed — read it back
      if (clear) setMsg('Split undone — back to one line.')
      else if (res && res.length && res.some(x => x.balanced === false)) {
        setMsg('Split saved, but the parts do not add back to the line. Check the percentages.')
      } else setMsg('Split. Any new part still needs its account.')
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
                        <select value={l.business || ''} disabled={busy === l.line_id}
                                onChange={e => code(r.receipt_id, l, e.target.value, l.gl_number)}>
                          <option value="">—</option>
                          {entities.map(b => <option key={b.code} value={b.code}>{b.code}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={l.gl_number || ''} disabled={!l.business || busy === l.line_id}
                                style={{ width: '100%' }}
                                onChange={e => code(r.receipt_id, l, l.business, e.target.value)}>
                          <option value="">—</option>
                          {accountsFor(l.business).map(a => (
                            <option key={a.number} value={a.number}>{a.number} — {a.name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ fontSize: 11 }}>
                        <div className="tickbox">
                          {projects.map(p => {
                            const on = (l.project_ids || []).includes(p.id)
                            return (
                              <label key={p.id} className="tick">
                                <input type="checkbox" checked={on} disabled={busy === l.line_id}
                                       onChange={() => setLineProjects(r.receipt_id, l,
                                         on ? (l.project_ids || []).filter(x => x !== p.id)
                                            : [...(l.project_ids || []), p.id])} />
                                {p.name}
                              </label>
                            )
                          })}
                        </div>
                      </td>
                      <td style={{ fontSize: 11 }}>
                        <button disabled={!l.gl_number || busy === l.line_id}
                                title="Copy this line's coding down onto every blank line below it."
                                onClick={() => fillDown(r.receipt_id, l)}>
                          fill down
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
                                  <td className="muted">
                                    % · ${money(num(l.amount) * num(p.pct) / 100)}
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
                            <button onClick={() => setParts(ps => [...ps, { business: '', pct: 0 }])}>
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
          </div>
        )
      })}
    </div>
  )
}
