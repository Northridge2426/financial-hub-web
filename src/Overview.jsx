import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'

export default function Overview() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    rpc('financial_overview').then(setRows).catch(e => setErr(e.message))
  }, [])

  if (err) return <div className="page"><div className="err">{err}</div></div>
  if (!rows) return <div className="page"><div className="loading">Reading every position…</div></div>

  const live = rows.filter(r => r.active)

  // `owed` is the figure to sum: for a liability it is what is outstanding, for
  // an asset it equals the balance. Summing `balance` across both would net a
  // card against a chequing account and read as though the debt were smaller.
  const assets = live.filter(r => r.kind === 'asset')
      .reduce((a, r) => a + Number(r.owed || 0), 0)
  const debts = live.filter(r => r.kind !== 'asset')
      .reduce((a, r) => a + Number(r.owed || 0), 0)

  // Preserve the order the function returns — it already sorts by group_sort.
  const groups = []
  for (const r of live) {
    let g = groups.find(x => x.code === r.group_code)
    if (!g) { g = { code: r.group_code, label: r.group_label, rows: [] }; groups.push(g) }
    g.rows.push(r)
  }

  return (
    <div className="page">
      <div className="grid" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="n">${money(assets)}</div>
          <div className="l">Cash and assets</div>
        </div>
        <div className="stat">
          <div className="n neg">${money(debts)}</div>
          <div className="l">Owed</div>
        </div>
        <div className="stat">
          <div className={'n ' + (assets - debts < 0 ? 'neg' : 'pos')}>
            ${money(assets - debts)}
          </div>
          <div className="l">Net</div>
        </div>
        <div className="stat">
          <div className="n">{live.length}</div>
          <div className="l">Active positions</div>
          <div className="sub">{rows.length - live.length} inactive, hidden</div>
        </div>
      </div>

      {groups.map(g => {
        const sub = g.rows.reduce((a, r) => a + Number(r.owed || 0), 0)
        return (
          <div className="card" key={g.code}>
            <h2>{g.label}</h2>
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th style={{ width: 62 }}>Entity</th>
                  <th style={{ width: 120 }}>Type</th>
                  <th className="num" style={{ width: 120 }}>Balance</th>
                  <th style={{ width: 210 }}>Basis</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map(r => (
                  <tr key={r.position_id}>
                    <td>
                      {r.name}
                      {r.notes && <div className="muted" style={{ fontSize: 11 }}>{r.notes}</div>}
                    </td>
                    <td><span className="pill">{r.business}</span></td>
                    <td className="muted">{r.class_label}</td>
                    <td className={'money ' + (r.kind === 'asset' ? '' : 'neg')}>
                      ${money(r.owed)}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {r.basis || '—'}
                      {!r.linked && <span className="muted"> · not linked</span>}
                    </td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={3}>{g.label} total</td>
                  <td className="money">${money(sub)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
