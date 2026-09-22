import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'
import { useEntities } from './useEntities.js'

/**
 * Chart of accounts. Reads `v_chart_of_accounts`, which carries not just the
 * account but the evidence about it: whether it has been posted to here, seen
 * in a Sage trial balance, or used by an allocation profile or a role.
 *
 * "Usable" is a decision someone made; the four evidence flags are facts. An
 * account marked unusable that is nevertheless in use is the thing worth
 * spotting, so it gets its own filter.
 */
export default function Accounts() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [biz, setBiz] = useState('')
  const [q, setQ] = useState('')
  const [view, setView] = useState('usable')
  const entities = useEntities()

  useEffect(() => {
    supabase.from('v_chart_of_accounts')
      .select('id,business,number,name,account_type,usable,postable,seen_in_tb,active_in_sage,usable_reason,sage_class,notes,posted_here,in_sage_journal,used_by_allocations,used_by_roles,is_a_bank_account')
      .order('business').order('number')
      .then(({ data, error }) => error ? setErr(error.message) : setRows(data || []))
  }, [])

  // These four are COUNTS in the view, not booleans — and in JSX `0 && <span/>`
  // renders a literal "0". Coerce before using them as conditions.
  const n = v => Number(v) > 0
  const inUse = r =>
    n(r.posted_here) || n(r.in_sage_journal) || n(r.used_by_allocations) || n(r.used_by_roles)

  const shown = useMemo(() => {
    if (!rows) return []
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (biz && r.business !== biz) return false
      if (view === 'usable' && !r.usable) return false
      if (view === 'unusable' && r.usable) return false
      if (view === 'conflict' && !(!r.usable && inUse(r))) return false
      if (view === 'unused' && inUse(r)) return false
      if (!needle) return true
      return `${r.number} ${r.name} ${r.account_type} ${r.sage_class || ''}`.toLowerCase().includes(needle)
    })
  }, [rows, biz, q, view])

  if (err) return <div className="page"><div className="err">{err}</div></div>
  if (!rows) return <div className="page"><div className="loading">Reading…</div></div>

  const conflicts = rows.filter(r => !r.usable && inUse(r))

  return (
    <div className="page">
      <p className="hint">
        Every account across the six sets of books. <b>Usable</b> is a decision; the flags on the
        right are evidence. An account marked unusable that something is still using is worth a
        second look.
      </p>

      <div className="bar">
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">All entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        <select value={view} onChange={e => setView(e.target.value)}>
          <option value="usable">Usable only</option>
          <option value="all">Everything</option>
          <option value="unusable">Not usable</option>
          <option value="conflict">Not usable, but in use ({conflicts.length})</option>
          <option value="unused">Never used</option>
        </select>
        <input type="search" placeholder="Number, name or class…" value={q}
               onChange={e => setQ(e.target.value)} style={{ width: 240 }} />
        <span className="muted" style={{ fontSize: 12 }}>{shown.length} of {rows.length}</span>
      </div>

      {conflicts.length > 0 && view !== 'conflict' && (
        <div className="note warn">
          <b>{conflicts.length} account{conflicts.length === 1 ? ' is' : 's are'} marked not usable
          but still in use</b> — posted here, in a Sage journal, or named by an allocation profile
          or role. Switch the filter to see them.
        </div>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th style={{ width: 66 }}>Entity</th>
              <th style={{ width: 80 }}>Number</th>
              <th>Name</th>
              <th style={{ width: 130 }}>Type</th>
              <th style={{ width: 140 }}>Sage class</th>
              <th style={{ width: 200 }}>Evidence</th>
              <th style={{ width: 80 }}>Usable</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={7} className="muted">Nothing matches those filters.</td></tr>
            )}
            {shown.map(r => (
              <tr key={r.id}>
                <td><span className="pill">{r.business}</span></td>
                <td className="muted">{r.number}</td>
                <td>
                  {r.name}
                  {n(r.is_a_bank_account) && <span className="pill soft">bank</span>}
                  {r.notes && <div className="muted" style={{ fontSize: 11 }}>{r.notes}</div>}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{r.account_type}</td>
                <td className="muted" style={{ fontSize: 12 }}>{r.sage_class || ''}</td>
                <td style={{ fontSize: 11 }}>
                  {n(r.posted_here) && <span className="pill soft">posted here</span>}
                  {n(r.in_sage_journal) && <span className="pill soft">Sage</span>}
                  {n(r.used_by_allocations) && <span className="pill hold">allocation</span>}
                  {n(r.used_by_roles) && <span className="pill hold">role</span>}
                  {r.seen_in_tb && <span className="pill">in TB</span>}
                  {!inUse(r) && !r.seen_in_tb && <span className="muted">—</span>}
                </td>
                <td>
                  {r.usable
                    ? <span className="pos">yes</span>
                    : <span className="neg" title={r.usable_reason || ''}>no</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
