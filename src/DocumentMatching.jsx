import { useCallback, useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money } from './format.js'
import DocLink from './DocLink.jsx'

const num = v => Number(v) || 0
const signed = v => (num(v) < 0 ? '−$' : '$') + money(Math.abs(num(v)))

/**
 * Queue 6 — Document matching.
 *
 * A document on file that belongs to no transaction. `loose_documents` names a
 * best candidate; opening a row shows every candidate behind that pick, because
 * the top scorer is sometimes the wrong one and a queue that only offers its
 * own guess makes the wrong one the easy answer.
 *
 * Attaching posts nothing. It says "this paperwork belongs to that line", which
 * is what moves the transaction into the queue that can code it.
 *
 * Invoices are deliberately absent: they live in queue 1, where booking them
 * raises a payable. A document that turns out to be an invoice is said so with
 * "This is a…" on the transaction, not attached here.
 */
export default function DocumentMatching() {
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(null)
  const [cands, setCands] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [accounts, setAccounts] = useState([])
  const [provFor, setProvFor] = useState(null)
  const [provAcct, setProvAcct] = useState('')
  const [provDir, setProvDir] = useState('outflow')

  const load = useCallback(async () => {
    setErr(''); setRows(null); setOpen(null); setCands(null)
    try { setRows(await rpc('loose_documents', { p_from: '2026-01-01' })) }
    catch (e) { setErr(e.message) }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    supabase.from('accounts').select('id,name').eq('active', true).order('name')
      .then(({ data }) => setAccounts(data || []))
  }, [])

  /**
   * A document whose bank line has not arrived.
   *
   * The instinct is to wait for the statement, and that instinct is what let
   * documents pile up for months. A provisional books the entry now against a
   * placeholder transaction; when the real line lands it is adopted and the
   * placeholder disappears, carrying everything across.
   */
  async function raiseProvisional(r) {
    if (!provAcct) { setErr('Say which account it was paid from.'); return }
    setBusy(r.receipt_id); setErr(''); setMsg('')
    try {
      const res = await rpc('create_provisional_transaction', {
        p_receipt: r.receipt_id, p_account: provAcct, p_direction: provDir,
      })
      setMsg(typeof res === 'string' ? res : 'Provisional raised.')
      setProvFor(null); setProvAcct('')
      await load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  async function show(r) {
    if (open === r.receipt_id) { setOpen(null); setCands(null); return }
    setOpen(r.receipt_id); setCands(null); setErr('')
    try { setCands(await rpc('web_document_candidates', { p_receipt: r.receipt_id })) }
    catch (e) { setErr(e.message) }
  }

  async function attach(receiptId, txnId, ref) {
    setBusy(txnId); setErr(''); setMsg('')
    try {
      const res = await rpc('attach_receipt', { p_receipt: receiptId, p_txn: txnId })
      setMsg(typeof res === 'string' ? res : `Attached to ${ref}.`)
      await load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  async function voidIt(receiptId, vendor) {
    if (!globalThis.confirm(
      `Void this ${vendor} document?\n\n`
      + 'It leaves every queue. Nothing is deleted and nothing is posted — but if anything '
      + 'is already booked against it the database will refuse.')) return
    setBusy(receiptId); setErr(''); setMsg('')
    try {
      const res = await rpc('void_document', {
        p_receipt: receiptId, p_reason: 'Voided from document matching — no transaction it belongs to.',
      })
      setMsg(typeof res === 'string' ? res : 'Voided.')
      await load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  return (
    <div className="page">
      <p className="hint">
        Documents on file that belong to no transaction. Attaching one <b>posts nothing</b> — it
        says which bank line the paperwork goes with, which is what moves that line into a queue
        that can code it. Invoices are not here; they are in queue 1, where booking them raises
        a payable.
      </p>

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      {!rows && !err && <div className="loading">Reading…</div>}
      {rows && rows.length === 0 && (
        <div className="card"><div className="muted">Nothing loose. Every document belongs to something.</div></div>
      )}

      {rows && rows.length > 0 && (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th style={{ width: 84 }}>Type</th>
                <th>Vendor</th>
                <th style={{ width: 120 }}>Reference</th>
                <th style={{ width: 96 }}>Dated</th>
                <th className="num" style={{ width: 104 }}>Amount</th>
                <th className="num" style={{ width: 80 }}>GST</th>
                <th style={{ width: 210 }}>Best guess</th>
                <th style={{ width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => [
                <tr key={r.receipt_id} className={'drill' + (open === r.receipt_id ? ' rowsel' : '')}
                    onClick={() => show(r)}>
                  <td><span className="pill soft">{r.doc_type}</span></td>
                  <td>{r.doc_vendor}</td>
                  <td className="muted">{r.doc_reference}</td>
                  <td>{r.doc_date}</td>
                  <td className="money">${money(r.doc_amount)}</td>
                  <td className="money">{num(r.doc_gst) ? money(r.doc_gst) : ''}</td>
                  <td style={{ fontSize: 11 }}>
                    {num(r.candidates) === 0
                      ? <span className="muted">nothing close</span>
                      : <>
                          <span className="pill">{r.best_ref}</span>
                          <span className="muted">
                            {' '}score {r.best_score}
                            {num(r.best_gap) ? `, ${r.best_gap}d apart` : ', same day'}
                          </span>
                          {num(r.candidates) > 1 && (
                            <div className="muted">{r.candidates} candidates</div>
                          )}
                        </>}
                  </td>
                  <td style={{ fontSize: 11 }}>
                    {r.storage_path && <DocLink path={r.storage_path} label="copy path" />}
                  </td>
                </tr>,
                open === r.receipt_id && (
                  <tr key={r.receipt_id + '-c'} className="expand">
                    <td colSpan={8}>
                      {!cands && <div className="loading">Looking…</div>}
                      {cands && cands.length === 0 && (
                        <div>
                          <div className="muted">
                            No transaction is close enough in date and amount to be a candidate.
                          </div>
                          <div className="bar" style={{ margin: '6px 0 0' }}>
                            <span className="muted" style={{ fontSize: 12 }}>
                              Either the bank line has not been imported yet, or it never will.
                            </span>
                            <span style={{ flex: 1 }} />
                            <button disabled={busy === r.receipt_id}
                                    onClick={() => { setProvFor(provFor === r.receipt_id ? null : r.receipt_id); setProvAcct('') }}>
                              {provFor === r.receipt_id ? 'Cancel' : 'Raise a provisional'}
                            </button>
                            <button disabled={busy === r.receipt_id}
                                    onClick={() => voidIt(r.receipt_id, r.doc_vendor)}>
                              {busy === r.receipt_id ? 'Voiding…' : 'Void this document'}
                            </button>
                          </div>

                          {provFor === r.receipt_id && (
                            <div className="bar" style={{ margin: '6px 0 0' }}>
                              <span style={{ fontSize: 12.5 }}>Paid from</span>
                              <select value={provAcct} style={{ minWidth: 240 }}
                                      onChange={e => setProvAcct(e.target.value)}>
                                <option value="">Which account…</option>
                                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                              </select>
                              <select value={provDir} onChange={e => setProvDir(e.target.value)}>
                                <option value="outflow">money out</option>
                                <option value="inflow">money in</option>
                              </select>
                              <button className="primary" disabled={!provAcct || busy === r.receipt_id}
                                      onClick={() => raiseProvisional(r)}>
                                {busy === r.receipt_id ? 'Raising…' : 'Raise it'}
                              </button>
                              <span className="muted" style={{ fontSize: 11.5 }}>
                                Book it now against a placeholder. When the real bank line arrives,
                                adopting it moves everything across and the placeholder goes away.
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                      {cands && cands.length > 0 && (
                        <table>
                          <thead>
                            <tr>
                              <th style={{ width: 84 }}>Ref</th>
                              <th style={{ width: 92 }}>Date</th>
                              <th style={{ width: 56 }}>Biz</th>
                              <th style={{ width: 140 }}>Account</th>
                              <th>Descriptor</th>
                              <th className="num" style={{ width: 104 }}>Amount</th>
                              <th style={{ width: 120 }}>Fit</th>
                              <th style={{ width: 110 }} />
                            </tr>
                          </thead>
                          <tbody>
                            {cands.map(c => (
                              <tr key={c.transaction_id}>
                                <td className="muted">{c.ref}</td>
                                <td>{c.txn_date}</td>
                                <td><span className="pill">{c.business}</span></td>
                                <td style={{ fontSize: 12 }}>{c.account}</td>
                                <td>
                                  {c.descr}
                                  {c.merchant && <div className="muted" style={{ fontSize: 11 }}>{c.merchant}</div>}
                                </td>
                                <td className={'money ' + (c.direction === 'inflow' ? 'pos' : '')}>
                                  {c.direction === 'inflow' ? '+' : '−'}${money(c.amount)}
                                </td>
                                <td style={{ fontSize: 11 }}>
                                  <span className="pill">{c.score}</span>
                                  <span className="muted">
                                    {num(c.day_gap) ? ` ${c.day_gap}d apart` : ' same day'}
                                  </span>
                                  {c.has_entry && (
                                    <div>
                                      <span className="pill soft" title="Already coded. Attaching the document is still right — it becomes the evidence behind an entry that was made without it.">
                                        already coded
                                      </span>
                                    </div>
                                  )}
                                </td>
                                <td>
                                  <button className="primary" disabled={busy === c.transaction_id}
                                          onClick={() => attach(r.receipt_id, c.transaction_id, c.ref)}>
                                    {busy === c.transaction_id ? 'Attaching…' : 'That one'}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                ),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
