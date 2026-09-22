import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'
import DrillLines from './DrillLines.jsx'

/**
 * Actuals by account — a pivot of accounts down, entities across.
 *
 * At account level the clickable thing is the CELL, not the row: a row spans
 * six entities and "what is this made of?" is always asked about one of them.
 */
export default function Actuals() {
  const [year, setYear] = useState('2026')
  const [kind, setKind] = useState('spending')
  const [level, setLevel] = useState('account')
  const [empty, setEmpty] = useState(false)
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)      // { number, business, gl }

  const from = `${year}-01-01`, to = `${year}-12-31`

  useEffect(() => {
    setRows(null); setErr(''); setOpen(null)
    const call = level === 'account'
      ? rpc('actuals_by_account', { p_from: from, p_to: to, p_kind: kind, p_include_empty: empty })
      : rpc('spending_report_grouped', { p_from: from, p_to: to, p_kind: kind, p_level: level })
    call.then(setRows).catch(e => setErr(e.message))
  }, [year, kind, level, empty])

  const byAccount = level === 'account'

  return (
    <div className="page">
      <div className="bar">
        <select value={year} onChange={e => setYear(e.target.value)}>
          {['2026', '2025'].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={kind} onChange={e => setKind(e.target.value)}>
          <option value="spending">Spending</option>
          <option value="revenue">Revenue</option>
        </select>
        <select value={level} onChange={e => setLevel(e.target.value)}>
          <option value="account">By account</option>
          <option value="group">By budget line</option>
          <option value="category">By category</option>
        </select>
        {byAccount && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input type="checkbox" checked={empty} onChange={e => setEmpty(e.target.checked)}
                   style={{ width: 'auto' }} />
            Show accounts with nothing in them
          </label>
        )}
      </div>

      {err && <div className="err">{err}</div>}
      {!rows && !err && <div className="loading">Running…</div>}
      {rows && rows.length === 0 && (
        <div className="card"><div className="muted">Nothing for those filters.</div></div>
      )}

      {rows && rows.length > 0 && (() => {
        const biz = [...new Set(rows.map(r => r.business))].sort()
        const key = r => byAccount ? r.number : r.label

        const seen = new Map()
        rows.forEach(r => { if (!seen.has(key(r))) seen.set(key(r), r) })
        const items = [...seen.values()]

        const cell = {}, glid = {}
        rows.forEach(r => {
          cell[key(r) + '|' + r.business] = Number(r.amount || 0)
          if (r.gl_account_id) glid[key(r) + '|' + r.business] = r.gl_account_id
        })
        const rowTot = k => biz.reduce((a, b) => a + (cell[k + '|' + b] || 0), 0)
        const colTot = b => items.reduce((a, r) => a + (cell[key(r) + '|' + b] || 0), 0)
        const grand = items.reduce((a, r) => a + rowTot(key(r)), 0)

        items.sort(byAccount
          ? (a, b) => String(a.number).localeCompare(String(b.number))
          : (a, b) => rowTot(key(b)) - rowTot(key(a)))

        return (
          <>
            <h2 className="rpt-title">
              Actuals by {byAccount ? 'account' : level} — {kind} {year}
            </h2>
            <div className="muted" style={{ marginBottom: 12, fontSize: 12 }}>
              {items.length} {byAccount ? 'accounts' : 'lines'} across {biz.length}{' '}
              entit{biz.length === 1 ? 'y' : 'ies'}
            </div>

            <div className="card">
              <table>
                <thead>
                  <tr>
                    {byAccount && <th style={{ width: '9%' }}>Account</th>}
                    <th>{byAccount ? 'Name' : level === 'group' ? 'Budget line' : 'Category'}</th>
                    {biz.map(b => <th key={b} className="num">{b}</th>)}
                    <th className="num">Total</th>
                    <th className="num" style={{ width: 60 }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(r => {
                    const k = key(r)
                    const isOpen = open && open.k === k
                    return [
                      <tr key={k}>
                        {byAccount && <td className="muted">{r.number}</td>}
                        <td>{byAccount ? r.name : r.label}</td>
                        {biz.map(b => {
                          const v = cell[k + '|' + b]
                          const g = glid[k + '|' + b]
                          const clickable = byAccount && v && g
                          return (
                            <td key={b}
                                className={'money ' + (v ? (clickable ? 'drill' : '') : 'muted')}
                                onClick={clickable
                                  ? () => setOpen(isOpen && open.b === b ? null : { k, b, gl: g })
                                  : undefined}>
                              {v ? money(v) : '·'}
                            </td>
                          )
                        })}
                        <td className="money"><b>{money(rowTot(k))}</b></td>
                        <td className="money">
                          {grand ? (rowTot(k) / grand * 100).toFixed(1) : '0.0'}%
                        </td>
                      </tr>,
                      isOpen && (
                        <tr key={k + '-x'} className="expand">
                          <td colSpan={biz.length + (byAccount ? 4 : 3)}>
                            <div className="muted" style={{ marginBottom: 4, fontSize: 12 }}>
                              {r.number} {r.name} · {open.b}
                            </div>
                            <DrillLines gl={open.gl} from={from} to={to} includeOpening={false} />
                          </td>
                        </tr>
                      ),
                    ]
                  })}
                  <tr className="total">
                    <td colSpan={byAccount ? 2 : 1}>Total</td>
                    {biz.map(b => <td key={b} className="money">{money(colTot(b))}</td>)}
                    <td className="money">{money(grand)}</td>
                    <td className="money">100.0%</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {byAccount && (
              <p className="hint">
                Click any figure to see the entries behind it. The cell is what you click, not the
                row — a row spans every entity, and the question is always about one of them.
              </p>
            )}
          </>
        )
      })()}
    </div>
  )
}
