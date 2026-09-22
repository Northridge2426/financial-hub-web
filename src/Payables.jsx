import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { money } from './format.js'
import DocLink from './DocLink.jsx'

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

  useEffect(() => {
    (async () => {
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
    })()
  }, [])

  if (err) return <div className="page"><div className="err">{err}</div></div>
  if (!rows) return <div className="page"><div className="loading">Reading…</div></div>

  const total = rows.reduce((a, r) => a + Number(r.balance || 0), 0)
  const overdue = rows.filter(r => Number(r.days_overdue) > 0)
  const offBy = control.filter(c => Math.abs(Number(c.difference)) > 0.01)

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
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="muted">
                Nothing outstanding. Invoices appear here once booked to payables.
              </td></tr>
            )}
            {rows.map(r => (
              <tr key={r.receipt_id + r.doc_date}>
                <td><span className="pill">{r.business}</span></td>
                <td className="muted">{r.doc_no}</td>
                <td>
                  {r.doc_vendor || '—'}
                  {r.storage_path && <DocLink path={r.storage_path} label="invoice" />}
                </td>
                <td className="muted">{r.doc_reference || ''}</td>
                <td>{r.doc_date || ''}</td>
                <td>{r.due_date || ''}</td>
                <td className="money">${money(r.balance)}</td>
                <td>
                  {Number(r.days_overdue) > 0 &&
                    <span className="pill hold">{r.days_overdue}d</span>}
                </td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="total">
                <td colSpan={6}>Total outstanding</td>
                <td className="money">${money(total)}</td>
                <td />
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
