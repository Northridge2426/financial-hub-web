import { Fragment, useEffect, useMemo, useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'
import { useEntities } from './useEntities.js'
import DocLink from './DocLink.jsx'
import DocumentList from './DocumentList.jsx'

const num = v => Number(v) || 0

/**
 * Vendor reports. `vendor_spend` gives the roll-up; clicking a vendor calls
 * `vendor_activity` for everything booked against them.
 *
 * `vendor_activity` is overloaded in the database — two signatures differing in
 * argument order. PostgREST picks by argument NAME, so the named call below is
 * unambiguous where a positional one would not be.
 *
 * DOCUMENTS. This is where William goes to find a vendor's history, so every
 * item carries its supporting document. `vendor_activity` already returns the
 * filed document's path (`storage_path`) and the bank line (`transaction_id`);
 * the path is copied in one click (see DocLink — a browser cannot open a
 * OneDrive file directly), and "all" opens the full list for that bank line —
 * receipts, anything filed against its journal entry, and the bank statement —
 * through the same `web_transaction_documents` the review panes use. Read-only
 * here: reclassifying a document belongs in the review queues, not a report.
 */
export default function Vendors() {
  const [biz, setBiz] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)
  const [activity, setActivity] = useState(null)
  const [actErr, setActErr] = useState('')
  const [docsOpen, setDocsOpen] = useState(null)
  const [onlyDocs, setOnlyDocs] = useState(false)
  const entities = useEntities()

  useEffect(() => {
    setRows(null); setErr(''); setOpen(null)
    rpc('vendor_spend', { p_business: biz || null, p_from: null, p_to: null })
      .then(setRows).catch(e => setErr(e.message))
  }, [biz])

  const shown = useMemo(() => {
    if (!rows) return []
    const needle = q.trim().toLowerCase()
    const list = needle
      ? rows.filter(r => String(r.vendor).toLowerCase().includes(needle))
      : rows
    return [...list].sort((a, b) => num(b.paid) - num(a.paid))
  }, [rows, q])

  async function toggle(r) {
    if (open === r.vendor_key) { setOpen(null); return }
    setOpen(r.vendor_key); setActivity(null); setActErr(''); setDocsOpen(null)
    try {
      setActivity(await rpc('vendor_activity', {
        p_vendor_key: r.vendor_key,
        p_business: biz || null,
        p_from: null,
        p_to: null,
      }))
    } catch (e) { setActErr(e.message) }
  }

  if (err) return <div className="page"><div className="err">{err}</div></div>
  if (!rows) return <div className="page"><div className="loading">Reading…</div></div>

  const totPaid = shown.reduce((a, r) => a + num(r.paid), 0)
  const totOut = shown.reduce((a, r) => a + num(r.outstanding), 0)
  const uncoded = shown.reduce((a, r) => a + num(r.uncoded), 0)

  return (
    <div className="page">
      <p className="hint">
        Who you pay, how much, and what is still open. Click a vendor to see everything booked
        against them.
      </p>

      <div className="bar">
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">All entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        <input type="search" placeholder="Vendor name…" value={q}
               onChange={e => setQ(e.target.value)} style={{ width: 220 }} />
        <span className="muted" style={{ fontSize: 12 }}>{shown.length} of {rows.length}</span>
      </div>

      <div className="grid" style={{ marginBottom: 14 }}>
        <div className="stat"><div className="n">{shown.length}</div><div className="l">vendors</div></div>
        <div className="stat"><div className="n">${money(totPaid)}</div><div className="l">paid</div></div>
        <div className="stat">
          <div className={'n ' + (totOut ? 'warn' : 'pos')}>${money(totOut)}</div>
          <div className="l">outstanding</div>
        </div>
        <div className="stat">
          <div className={'n ' + (uncoded ? 'warn' : 'pos')}>{uncoded}</div>
          <div className="l">uncoded payments</div>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Vendor</th>
              <th style={{ width: 110 }}>Entities</th>
              <th className="num" style={{ width: 62 }}>Payments</th>
              <th className="num" style={{ width: 110 }}>Paid</th>
              <th className="num" style={{ width: 110 }}>Billed</th>
              <th className="num" style={{ width: 110 }}>Outstanding</th>
              <th className="num" style={{ width: 72 }}>Uncoded</th>
              <th style={{ width: 100 }}>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={8} className="muted">No vendors match.</td></tr>
            )}
            {shown.map(r => [
              <tr key={r.vendor_key} className="drill" onClick={() => toggle(r)}>
                <td><b>{r.vendor}</b></td>
                <td className="muted" style={{ fontSize: 12 }}>{r.entities}</td>
                <td className="money">{r.payments}</td>
                <td className="money">${money(r.paid)}</td>
                <td className="money">{num(r.billed) ? '$' + money(r.billed) : <span className="muted">—</span>}</td>
                <td className={'money ' + (num(r.outstanding) ? 'due-soon' : '')}>
                  {num(r.outstanding) ? '$' + money(r.outstanding) : <span className="muted">—</span>}
                </td>
                <td className="money">
                  {num(r.uncoded) ? <span className="pill hold">{r.uncoded}</span> : <span className="muted">—</span>}
                </td>
                <td>{r.last_seen || ''}</td>
              </tr>,
              open === r.vendor_key && (
                <tr key={r.vendor_key + '-x'} className="expand">
                  <td colSpan={8}>
                    {actErr && <div className="err">{actErr}</div>}
                    {!activity && !actErr && <div className="loading">Reading the activity…</div>}
                    {activity && activity.length === 0 && (
                      <div className="muted">Nothing booked against this vendor.</div>
                    )}
                    {activity && activity.length > 0 && (
                      <div className="bar" style={{ margin: '0 0 6px' }}>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {activity.filter(a => a.storage_path).length} of {activity.length} items
                          have a filed document
                        </span>
                        <label style={{ fontSize: 12 }}>
                          <input type="checkbox" checked={onlyDocs}
                                 onChange={e => { setOnlyDocs(e.target.checked); setDocsOpen(null) }} />
                          {' '}only items with a document
                        </label>
                      </div>
                    )}
                    {activity && activity.length > 0 && (
                      <table>
                        <thead>
                          <tr>
                            <th style={{ width: 96 }}>Date</th>
                            <th style={{ width: 90 }}>Kind</th>
                            <th style={{ width: 62 }}>Entity</th>
                            <th style={{ width: 90 }}>Txn</th>
                            <th>Reference</th>
                            <th className="num" style={{ width: 110 }}>Amount</th>
                            <th style={{ width: 160 }}>Paid from</th>
                            <th style={{ width: 150 }}>Documents</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activity.filter(a => !onlyDocs || a.storage_path).map((a, i) => {
                            const k = (a.transaction_id || a.receipt_id || 'row') + '-' + i
                            const shut = docsOpen !== k
                            return (
                            <Fragment key={k}>
                            <tr>
                              <td>{a.entry_date}</td>
                              <td><span className="pill">{a.kind}</span></td>
                              <td className="muted">{a.entity || ''}</td>
                              <td className="muted">{a.txn_ref || ''}</td>
                              <td>
                                {a.doc_reference || ''}
                                {a.is_coded === false && <span className="pill hold">uncoded</span>}
                              </td>
                              <td className="money">${money(a.amount)}</td>
                              <td style={{ fontSize: 12 }}>{a.paid_from || ''}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {a.storage_path
                                  ? <DocLink path={a.storage_path} label="copy path" />
                                  : <span className="muted" style={{ fontSize: 11 }}
                                          title={a.receipt_id
                                            ? 'Recorded from an email — vendor, date and amount only. No file was ever saved.'
                                            : 'No receipt or invoice filed against this item.'}>
                                      {a.receipt_id ? 'no file' : 'none'}
                                    </span>}
                                {a.transaction_id && (
                                  <span className="doclink">
                                    <button onClick={() => setDocsOpen(shut ? k : null)}
                                            title="Every document for this bank line, including the statement">
                                      {shut ? 'all ▸' : 'all ▾'}
                                    </button>
                                  </span>
                                )}
                              </td>
                            </tr>
                            {!shut && (
                              <tr className="expand">
                                <td colSpan={8}>
                                  <DocumentList txnId={a.transaction_id} readOnly />
                                </td>
                              </tr>
                            )}
                            </Fragment>
                            )
                          })}
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
    </div>
  )
}
