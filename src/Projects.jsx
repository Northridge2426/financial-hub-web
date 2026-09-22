import { useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money, today } from './format.js'
import { useEntities } from './useEntities.js'

const num = v => Number(v) || 0
const signed = v => (num(v) < 0 ? '−$' : '$') + money(Math.abs(num(v)))

/**
 * Project report. Projects are tags, not containers — a line can carry several,
 * so `shared_lines` counts the ones that also belong to another project. Adding
 * the projects together therefore double-counts those lines on purpose; the
 * alternative would be to pick a winner, which would be a lie.
 *
 * `project_report` is overloaded; the uuid[] signature is the one wanted here,
 * and PostgREST resolves it by the argument names supplied.
 */
export default function Projects() {
  const [projects, setProjects] = useState([])
  const [picked, setPicked] = useState([])
  const [biz, setBiz] = useState('')
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState(today())
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const entities = useEntities()

  useEffect(() => {
    supabase.from('projects').select('id,name').eq('active', true).order('name')
      .then(({ data }) => setProjects(data || []))
  }, [])

  useEffect(() => {
    setData(null); setErr('')
    const args = {
      p_projects: picked.length ? picked : null,
      p_from: from, p_to: to,
      p_business: biz || null,
    }
    Promise.all([rpc('project_report_totals', args), rpc('project_report', args)])
      .then(([totals, lines]) => setData({ totals, lines }))
      .catch(e => setErr(e.message))
  }, [picked, biz, from, to])

  const toggle = id =>
    setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  return (
    <div className="page">
      <p className="hint">
        Projects are tags, not folders — a line can carry several. A line counted under two
        projects appears under both, which is why the totals below do not add to a grand total.
      </p>

      <div className="bar">
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">All entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        <label htmlFor="prFrom">From</label>
        <input id="prFrom" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label htmlFor="prTo">To</label>
        <input id="prTo" type="date" value={to} onChange={e => setTo(e.target.value)} />
        {picked.length > 0 && (
          <button onClick={() => setPicked([])}>Clear {picked.length} selected</button>
        )}
      </div>

      <div className="card">
        <h2>Projects</h2>
        <div className="tickgrid">
          {projects.map(p => (
            <label key={p.id} className="tick">
              <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
              {p.name}
            </label>
          ))}
        </div>
        {picked.length === 0 && (
          <p className="hint" style={{ margin: '8px 0 0' }}>Nothing ticked — showing every project.</p>
        )}
      </div>

      {err && <div className="err">{err}</div>}
      {!data && !err && <div className="loading">Reading…</div>}

      {data && data.totals.length === 0 && (
        <div className="card"><div className="muted">Nothing booked to a project in that window.</div></div>
      )}

      {data && data.totals.length > 0 && (
        <>
          <div className="card">
            <h2>Totals</h2>
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th className="num" style={{ width: 120 }}>Revenue</th>
                  <th className="num" style={{ width: 120 }}>Expense</th>
                  <th className="num" style={{ width: 120 }}>Net</th>
                  <th className="num" style={{ width: 70 }}>Lines</th>
                  <th className="num" style={{ width: 90 }}>Shared</th>
                </tr>
              </thead>
              <tbody>
                {[...data.totals].sort((a, b) => a.sort_key - b.sort_key).map(t => (
                  <tr key={t.project}>
                    <td><b>{t.project}</b></td>
                    <td className="money">{num(t.revenue) ? '$' + money(t.revenue) : <span className="muted">—</span>}</td>
                    <td className="money">{num(t.expense) ? '$' + money(t.expense) : <span className="muted">—</span>}</td>
                    <td className={'money ' + (num(t.net) < 0 ? 'neg' : 'pos')}>{signed(t.net)}</td>
                    <td className="money">{t.lines}</td>
                    <td className="money">
                      {num(t.shared_lines)
                        ? <span className="pill hold" title="Lines that also belong to another project.">
                            {t.shared_lines}
                          </span>
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(() => {
            const byProject = []
            for (const l of data.lines) {
              let g = byProject.find(x => x.project === l.project)
              if (!g) { g = { project: l.project, rows: [] }; byProject.push(g) }
              g.rows.push(l)
            }
            return byProject.map(g => (
              <div className="card" key={g.project}>
                <h2>{g.project}</h2>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 62 }}>Entity</th>
                      <th style={{ width: 110 }}>Section</th>
                      <th style={{ width: 80 }}>Number</th>
                      <th>Account</th>
                      <th className="num" style={{ width: 110 }}>Debit</th>
                      <th className="num" style={{ width: 110 }}>Credit</th>
                      <th className="num" style={{ width: 110 }}>Net</th>
                      <th className="num" style={{ width: 60 }}>Lines</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r, i) => (
                      <tr key={i}>
                        <td><span className="pill">{r.business}</span></td>
                        <td className="muted" style={{ fontSize: 12 }}>{r.section}</td>
                        <td className="muted">{r.gl_number}</td>
                        <td>{r.account}</td>
                        <td className="money">{num(r.debit) ? money(r.debit) : ''}</td>
                        <td className="money">{num(r.credit) ? money(r.credit) : ''}</td>
                        <td className="money"><b>{signed(r.net)}</b></td>
                        <td className="money">{r.lines}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          })()}
        </>
      )}
    </div>
  )
}
