import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money, today } from './format.js'
import { useEntities } from './useEntities.js'

const num = v => Number(v) || 0
/** Sections arrive prefixed "1 ", "2 ", "3 " to force their order. */
const secLabel = s => String(s || '').slice(2)

export default function Revenue() {
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState(today())
  const [biz, setBiz] = useState('')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)        // ym currently expanded
  const [entries, setEntries] = useState(null)
  const [entErr, setEntErr] = useState('')
  const entities = useEntities()

  useEffect(() => {
    setRows(null); setErr(''); setOpen(null)
    rpc('revenue_report', { p_from: from, p_to: to, p_biz: biz || null })
      .then(setRows).catch(e => setErr(e.message))
  }, [from, to, biz])

  async function toggle(ym) {
    if (open === ym) { setOpen(null); return }
    setOpen(ym); setEntries(null); setEntErr('')
    // Fetched per month rather than all at once: the whole-range query was slow
    // enough in the console to lose a race and leave the table empty.
    const lo = `${ym}-01`
    const [y, m] = ym.split('-').map(Number)
    const hi = new Date(y, m, 0)          // day 0 of next month = last of this
    const hiStr = `${y}-${String(m).padStart(2, '0')}-${String(hi.getDate()).padStart(2, '0')}`
    try {
      setEntries(await rpc('revenue_entries', { p_from: lo, p_to: hiStr, p_biz: biz || null }))
    } catch (e) { setEntErr(e.message) }
  }

  return (
    <div className="page">
      <p className="hint">
        Revenue as booked, by month and account, with the entries behind each month. Gross is
        before discounts; net is what actually landed.
      </p>

      <div className="bar">
        <label htmlFor="rvFrom">From</label>
        <input id="rvFrom" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label htmlFor="rvTo">To</label>
        <input id="rvTo" type="date" value={to} onChange={e => setTo(e.target.value)} />
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">All entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
      </div>

      {err && <div className="err">{err}</div>}
      {!rows && !err && <div className="loading">Reading…</div>}
      {rows && rows.length === 0 && (
        <div className="card"><div className="muted">No revenue booked in that window.</div></div>
      )}

      {rows && rows.length > 0 && (() => {
        const months = [...new Set(rows.map(r => r.ym))].sort()
        const sum = (ym, sec) => rows
          .filter(r => r.ym === ym && String(r.section).startsWith(sec))
          .reduce((a, r) => a + num(r.amount), 0)
        const tot = months.reduce((a, m) => a + sum(m, '1'), 0)
        const dis = months.reduce((a, m) => a + sum(m, '2'), 0)
        const gst = months.reduce((a, m) => a + sum(m, '3'), 0)

        return (
          <>
            <div className="grid" style={{ marginBottom: 14 }}>
              <div className="stat"><div className="n">${money(tot)}</div><div className="l">revenue at gross</div></div>
              <div className="stat"><div className="n">${money(dis)}</div><div className="l">discounts</div></div>
              <div className="stat"><div className="n">${money(tot + dis)}</div><div className="l">net revenue</div></div>
              <div className="stat"><div className="n">${money(gst)}</div><div className="l">GST collected</div></div>
            </div>

            {months.map(ym => {
              const mr = rows.filter(r => r.ym === ym)
              let lastSec = null
              return (
                <div className="card" key={ym}>
                  <h2 className="clickable" onClick={() => toggle(ym)}>
                    {ym}{' '}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      — net ${money(sum(ym, '1') + sum(ym, '2'))} · click to see the entries{' '}
                      {open === ym ? '▾' : '▸'}
                    </span>
                  </h2>
                  <table>
                    <tbody>
                      {mr.map((r, i) => {
                        const head = r.section !== lastSec ? (lastSec = r.section) : null
                        return [
                          head && (
                            <tr key={'s' + i} className="secrow">
                              <td colSpan={3}>{secLabel(r.section)}</td>
                            </tr>
                          ),
                          <tr key={'r' + i}>
                            <td className="muted" style={{ width: 70 }}>{r.gl_number}</td>
                            <td>{r.gl_name}</td>
                            <td className="money" style={{ width: 120 }}>${money(r.amount)}</td>
                          </tr>,
                        ]
                      })}
                    </tbody>
                  </table>

                  {open === ym && (
                    <div style={{ marginTop: 8 }}>
                      {entErr && <div className="err">{entErr}</div>}
                      {!entries && !entErr && <div className="loading">Reading the entries…</div>}
                      {entries && entries.length === 0 && (
                        <div className="muted">No entries came back for {ym}.</div>
                      )}
                      {entries && entries.length > 0 && (
                        <table>
                          <thead>
                            <tr>
                              <th style={{ width: 130 }}>Entry</th>
                              <th style={{ width: 96 }}>Date</th>
                              <th className="num">Gross</th>
                              <th className="num">Discounts</th>
                              <th className="num">GST</th>
                              <th className="num">Collected</th>
                              <th style={{ width: 150 }}>From</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map(e => (
                              <tr key={e.entry_key}>
                                <td className="muted">{e.entry_ref}</td>
                                <td>{e.entry_date}</td>
                                <td className="money">${money(e.gross)}</td>
                                <td className="money">
                                  {num(e.discounts) ? '$' + money(e.discounts) : <span className="muted">—</span>}
                                </td>
                                <td className="money">${money(e.gst)}</td>
                                <td className="money">${money(e.collected)}</td>
                                <td style={{ fontSize: 11.5 }}>
                                  <span className="pill">{e.source}</span>
                                  {e.source_file && (
                                    <div className="muted" style={{ fontSize: 11 }}>{e.source_file}</div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )
      })()}
    </div>
  )
}
