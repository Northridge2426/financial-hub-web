import { useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money, today } from './format.js'
import { useEntities } from './useEntities.js'
import ProjectLines from './ProjectLines.jsx'
import PeriodPicker from './PeriodPicker.jsx'

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
  const [newProj, setNewProj] = useState('')
  const [newKind, setNewKind] = useState('other')
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState('')
  // which figure is opened to its lines: 'T:<project id>' for a total,
  // '<project id>|<entity>|<account>' for an account row
  const [openKey, setOpenKey] = useState(null)
  const entities = useEntities()

  const loadProjects = () =>
    supabase.from('projects').select('id,name').eq('active', true).order('name')
      .then(({ data }) => setProjects(data || []))

  useEffect(() => { loadProjects() }, [])

  // create_project is idempotent by name — it returns `created: false` and the
  // existing id rather than raising, so typing a name that already exists
  // selects it instead of making a second project with the same name.
  async function addProject() {
    if (!newProj.trim()) return
    setAdding(true); setErr(''); setMsg('')
    try {
      const r = await rpc('create_project', { p_name: newProj.trim(), p_kind: newKind })
      const made = r && r[0]
      setMsg(made && made.created === false
        ? `"${made.name}" already existed — ticked it rather than making a second one.`
        : `"${newProj.trim()}" created.`)
      setNewProj('')
      await loadProjects()
      if (made && made.id) setPicked(p => p.includes(made.id) ? p : [...p, made.id])
    } catch (e) { setErr(e.message) }
    setAdding(false)
  }

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

  // a different window or filter means different lines; close whatever was open
  useEffect(() => { setOpenKey(null) }, [picked, biz, from, to])

  const flip = k => setOpenKey(o => (o === k ? null : k))
  // re-read the totals after a re-code, without losing the open drill-down
  const refresh = () => Promise.all([
    rpc('project_report_totals', { p_projects: picked.length ? picked : null, p_from: from, p_to: to, p_business: biz || null }),
    rpc('project_report', { p_projects: picked.length ? picked : null, p_from: from, p_to: to, p_business: biz || null }),
  ]).then(([totals, lines]) => setData({ totals, lines })).catch(e => setErr(e.message))

  const toggle = id =>
    setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  return (
    <div className="page">
      <p className="hint">
        Projects are tags, not folders — a line can carry several. A line counted under two
        projects appears under both, which is why the totals below do not add to a grand total.
        Click a project or an account row to see its ledger lines; click a line for its entry,
        documents and coding. Each line can carry a note for this project.
      </p>

      <div className="bar">
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">All entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        <PeriodPicker from={from} to={to} onChange={p => { setFrom(p.from); setTo(p.to) }} />
        <label htmlFor="prFrom">From</label>
        <input id="prFrom" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label htmlFor="prTo">To</label>
        <input id="prTo" type="date" value={to} onChange={e => setTo(e.target.value)} />
        {picked.length > 0 && (
          <button onClick={() => setPicked([])}>Clear {picked.length} selected</button>
        )}
        <span style={{ flex: 1 }} />
        <input value={newProj} placeholder="A new project…" style={{ width: 200 }}
               onChange={e => setNewProj(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') addProject() }} />
        <select value={newKind} onChange={e => setNewKind(e.target.value)}>
          <option value="other">other</option>
          <option value="property">property</option>
          <option value="job">job</option>
        </select>
        <button disabled={!newProj.trim() || adding} onClick={addProject}>
          {adding ? 'Adding…' : 'Add'}
        </button>
      </div>

      {msg && <div className="note good">{msg}</div>}
      {err && <div className="err">{err}</div>}

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
                {[...data.totals].sort((a, b) => a.sort_key - b.sort_key).flatMap(t => {
                  // totals carry the name only; project_report's rows carry the id
                  const pid = (data.lines.find(l => l.project === t.project) || {}).project_id
                  const k = 'T:' + pid
                  const isOpen = !!pid && openKey === k
                  return [
                  <tr key={t.project} className={(pid ? 'drill' : '') + (isOpen ? ' rowsel' : '')}
                      title={pid ? 'Show every line in this project' : undefined}
                      onClick={() => pid && flip(k)}>
                    <td><span className="caret">{pid ? (isOpen ? '▾' : '▸') : ''}</span> <b>{t.project}</b></td>
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
                  </tr>,
                  isOpen && (
                    <tr key={t.project + '-d'} className="expand">
                      <td colSpan={6}>
                        <ProjectLines project={pid} from={from} to={to} business={biz}
                                      onChanged={refresh} />
                      </td>
                    </tr>
                  ),
                  ]
                })}
              </tbody>
            </table>
          </div>

          {(() => {
            const byProject = []
            for (const l of data.lines) {
              let g = byProject.find(x => x.project === l.project)
              if (!g) { g = { project: l.project, id: l.project_id, rows: [] }; byProject.push(g) }
              g.rows.push(l)
            }
            return byProject.map(g => (
              <div className="card" key={g.project}>
                <h2>{g.project}</h2>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 80 }}>Entity</th>
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
                    {g.rows.flatMap((r, i) => {
                      const k = `${g.id}|${r.business}|${r.gl_number}`
                      const isOpen = openKey === k
                      return [
                      <tr key={k} className={'drill' + (isOpen ? ' rowsel' : '')}
                          title="Show the ledger lines behind this figure"
                          onClick={() => flip(k)}>
                        <td><span className="caret">{isOpen ? '▾' : '▸'}</span> <span className="pill">{r.business}</span></td>
                        <td className="muted" style={{ fontSize: 12 }}>{r.section}</td>
                        <td className="muted">{r.gl_number}</td>
                        <td>{r.account}</td>
                        <td className="money">{num(r.debit) ? money(r.debit) : ''}</td>
                        <td className="money">{num(r.credit) ? money(r.credit) : ''}</td>
                        <td className="money"><b>{signed(r.net)}</b></td>
                        <td className="money">{r.lines}</td>
                      </tr>,
                      isOpen && (
                        <tr key={k + '-d'} className="expand">
                          <td colSpan={8}>
                            <ProjectLines project={g.id} from={from} to={to}
                                          business={r.business} glNumber={r.gl_number}
                                          onChanged={refresh} />
                          </td>
                        </tr>
                      ),
                      ]
                    })}
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
