import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'
import DocLink from './DocLink.jsx'
import { useEntities } from './useEntities.js'

const num = v => Number(v) || 0

/** Every filed statement, with whether its lines were loaded and whether the
 *  period reconciled. A statement on disk that nobody read is the gap worth
 *  seeing, so "lines loaded = 0" gets its own filter. */
export default function Statements() {
  const [biz, setBiz] = useState('')
  const [find, setFind] = useState('')
  const [view, setView] = useState('all')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const entities = useEntities()

  useEffect(() => {
    const handle = setTimeout(() => {
      setRows(null); setErr('')
      rpc('statement_directory', {
        p_from: null, p_to: null,
        p_biz: biz || null,
        p_find: find.trim() || null,
      }).then(setRows).catch(e => setErr(e.message))
    }, 250)
    return () => clearTimeout(handle)
  }, [biz, find])

  const shown = (rows || []).filter(r =>
    view === 'all' ? true
      : view === 'unread' ? num(r.lines_loaded) === 0
      : view === 'unreconciled' ? !r.reconciled
      : true)

  return (
    <div className="page">
      <p className="hint">
        Every statement filed, newest first. <b>Lines</b> is how many transactions were read out of
        it — a statement sitting on disk that nobody read is the gap worth finding.
      </p>

      <div className="bar">
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">All entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        <select value={view} onChange={e => setView(e.target.value)}>
          <option value="all">Everything</option>
          <option value="unread">No lines loaded</option>
          <option value="unreconciled">Not reconciled</option>
        </select>
        <input type="search" placeholder="Account, institution, last 4…" value={find}
               onChange={e => setFind(e.target.value)} style={{ width: 230 }} />
        {rows && <span className="muted" style={{ fontSize: 12 }}>{shown.length} of {rows.length}</span>}
      </div>

      {err && <div className="err">{err}</div>}
      {!rows && !err && <div className="loading">Reading…</div>}

      {rows && (() => {
        const unread = rows.filter(r => num(r.lines_loaded) === 0).length
        const unrec = rows.filter(r => !r.reconciled).length
        return (
          <>
            <div className="grid" style={{ marginBottom: 14 }}>
              <div className="stat"><div className="n">{rows.length}</div><div className="l">statements filed</div></div>
              <div className="stat">
                <div className={'n ' + (unread ? 'warn' : 'pos')}>{unread}</div>
                <div className="l">with no lines loaded</div>
              </div>
              <div className="stat">
                <div className={'n ' + (unrec ? 'warn' : 'pos')}>{unrec}</div>
                <div className="l">not reconciled</div>
              </div>
              <div className="stat">
                <div className="n">{new Set(rows.map(r => r.account)).size}</div>
                <div className="l">accounts</div>
              </div>
            </div>

            <div className="card">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 62 }}>Entity</th>
                    <th>Account</th>
                    <th style={{ width: 110 }}>Institution</th>
                    <th style={{ width: 170 }}>Period</th>
                    <th className="num" style={{ width: 110 }}>Opening</th>
                    <th className="num" style={{ width: 110 }}>Closing</th>
                    <th className="num" style={{ width: 58 }}>Lines</th>
                    <th style={{ width: 96 }}>State</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr><td colSpan={8} className="muted">Nothing matches those filters.</td></tr>
                  )}
                  {shown.map(r => (
                    <tr key={r.statement_id}>
                      <td><span className="pill">{r.business}</span></td>
                      <td>
                        {r.account}
                        {r.last4 && <span className="muted"> ····{r.last4}</span>}
                        {r.file_name && (
                          <div className="muted" style={{ fontSize: 11 }}>{r.file_name}</div>
                        )}
                        {r.file_path && <DocLink path={r.file_path} label="open" />}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>{r.institution}</td>
                      <td style={{ fontSize: 12 }}>{r.period_start} → {r.period_end}</td>
                      <td className="money">${money(r.opening_balance)}</td>
                      <td className="money">${money(r.closing_balance)}</td>
                      <td className="money">
                        {num(r.lines_loaded)
                          ? r.lines_loaded
                          : <span className="pill hold">0</span>}
                      </td>
                      <td>
                        {r.reconciled
                          ? <span className="pill soft">reconciled</span>
                          : <span className="muted">open</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      })()}
    </div>
  )
}
