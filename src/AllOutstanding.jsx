import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'
import { money } from './format.js'

const num = v => Number(v) || 0

/**
 * All outstanding — everything still uncoded, whatever the reason.
 *
 * `why` is the view's own explanation of why a line is still here. It is the
 * most useful column on the page and the reason this list beats filtering the
 * review queue by hand: the answer to "why is this still open?" is already
 * worked out.
 */
export default function AllOutstanding() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [group, setGroup] = useState('')
  const [account, setAccount] = useState('')
  const [why, setWhy] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    supabase.from('v_all_outstanding')
      .select('id,ref,txn_date,account,entity,amount,direction,descr,merchant,status,support_status,provisional,is_transfer,paired,has_statement,docs,docs_with_file,vendor_group,quick_rule,pair_ref,why,open_notes,last_note,last_reply')
      // queue_counts() counts this as `where not paired` — a row whose other
      // half is already matched is not outstanding. Without this the page said
      // 394 against a badge of 215.
      .eq('paired', false)
      .order('txn_date', { ascending: false })
      .then(({ data, error }) => error ? setErr(error.message) : setRows(data || []))
  }, [])

  const groups = useMemo(
    () => [...new Set((rows || []).map(r => r.vendor_group).filter(Boolean))].sort(), [rows])
  const accounts = useMemo(
    () => [...new Set((rows || []).map(r => r.account).filter(Boolean))].sort(), [rows])
  const whys = useMemo(
    () => [...new Set((rows || []).map(r => r.why).filter(Boolean))].sort(), [rows])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (rows || []).filter(r =>
      (!group || r.vendor_group === group) &&
      (!account || r.account === account) &&
      (!why || r.why === why) &&
      (!needle || `${r.ref} ${r.descr} ${r.merchant || ''}`.toLowerCase().includes(needle)))
  }, [rows, group, account, why, q])

  if (err) return <div className="page"><div className="err">{err}</div></div>
  if (!rows) return <div className="page"><div className="loading">Loading…</div></div>

  const total = shown.reduce((a, r) => a + num(r.amount), 0)
  const withDoc = shown.filter(r => num(r.docs) > 0).length
  const openNotes = shown.filter(r => num(r.open_notes) > 0).length

  return (
    <div className="page">
      <p className="hint">
        Everything still uncoded, whatever the reason — the catch-all behind the numbered queues.
        The <b>why</b> column is the view's own account of what is holding each line up.
      </p>

      <div className="bar">
        <select value={group} onChange={e => setGroup(e.target.value)}>
          <option value="">All vendor groups</option>
          {groups.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={account} onChange={e => setAccount(e.target.value)} style={{ maxWidth: 230 }}>
          <option value="">All accounts</option>
          {accounts.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={why} onChange={e => setWhy(e.target.value)} style={{ maxWidth: 280 }}>
          <option value="">Any reason</option>
          {whys.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
        <input type="search" placeholder="Ref, description, merchant…" value={q}
               onChange={e => setQ(e.target.value)} style={{ width: 230 }} />
        <span className="muted" style={{ fontSize: 12 }}>{shown.length} of {rows.length}</span>
      </div>

      <div className="grid" style={{ marginBottom: 14 }}>
        <div className="stat"><div className="n">{shown.length}</div><div className="l">still uncoded</div></div>
        <div className="stat"><div className="n">${money(total)}</div><div className="l">total</div></div>
        <div className="stat"><div className="n">{withDoc}</div><div className="l">have a document</div></div>
        <div className="stat">
          <div className={'n ' + (openNotes ? 'warn' : '')}>{openNotes}</div>
          <div className="l">notes waiting on the morning task</div>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th style={{ width: 84 }}>Ref</th>
              <th style={{ width: 92 }}>Date</th>
              <th style={{ width: 150 }}>Account</th>
              <th>Description</th>
              <th className="num" style={{ width: 110 }}>Amount</th>
              <th style={{ width: 120 }}>Group</th>
              <th style={{ width: 230 }}>Why it is still here</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={7} className="muted">Nothing matches those filters.</td></tr>
            )}
            {shown.map(r => (
              <tr key={r.id}>
                <td className="muted">{r.ref}</td>
                <td>{r.txn_date}</td>
                <td style={{ fontSize: 12 }}>
                  {r.account}
                  {r.entity && <span className="pill">{r.entity}</span>}
                </td>
                <td>
                  {r.descr}
                  {r.merchant && (
                    <div className="muted" style={{ fontSize: 11 }}>{r.merchant}</div>
                  )}
                </td>
                <td className={'money ' + (r.direction === 'inflow' ? 'pos' : '')}>
                  ${money(r.amount)}
                </td>
                <td style={{ fontSize: 11 }}>
                  {r.vendor_group && <span className="pill">{r.vendor_group}</span>}
                  {r.quick_rule && <span className="pill soft" title="A rule recognises this.">rule</span>}
                </td>
                <td style={{ fontSize: 11.5 }}>
                  {r.why}
                  {num(r.open_notes) > 0 && (
                    <div className="due-soon" style={{ marginTop: 2 }}>
                      <b>note:</b> {r.last_note}
                      {r.last_reply && <div className="muted">↳ {r.last_reply}</div>}
                    </div>
                  )}
                  <div>
                    {r.provisional && <span className="pill hold">provisional</span>}
                    {r.is_transfer && <span className="pill hold">transfer</span>}
                    {r.paired && <span className="pill soft">paired {r.pair_ref || ''}</span>}
                    {num(r.docs) > 0 && (
                      <span className="pill soft">
                        {r.docs} doc{num(r.docs) === 1 ? '' : 's'}
                        {num(r.docs_with_file) < num(r.docs) && ' (no file)'}
                      </span>
                    )}
                    {r.has_statement && <span className="pill">stmt</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
