import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money, today } from './format.js'
import { useEntities } from './useEntities.js'

const num = v => Number(v) || 0

export default function Subscriptions() {
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState(today())
  const [biz, setBiz] = useState('')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const entities = useEntities()

  useEffect(() => {
    setRows(null); setErr('')
    rpc('subscriptions_report', { p_from: from, p_to: to, p_biz: biz || null })
      .then(setRows).catch(e => setErr(e.message))
  }, [from, to, biz])

  return (
    <div className="page">
      <p className="hint">
        What bills on a rhythm and is coded to a Subscriptions account. Anything still sitting in
        Quick Review is counted separately — it has not reached the ledger yet.
      </p>

      <div className="bar">
        <label htmlFor="sbFrom">From</label>
        <input id="sbFrom" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label htmlFor="sbTo">To</label>
        <input id="sbTo" type="date" value={to} onChange={e => setTo(e.target.value)} />
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">All entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
      </div>

      {err && <div className="err">{err}</div>}
      {!rows && !err && <div className="loading">Reading…</div>}
      {rows && rows.length === 0 && (
        <div className="card">
          <div className="muted">Nothing coded to a Subscriptions account in that window.</div>
        </div>
      )}

      {rows && rows.length > 0 && (() => {
        const tot = rows.reduce((a, r) => a + num(r.total), 0)
        const pend = rows.reduce((a, r) => a + num(r.pending_total), 0)
        const rate = rows.filter(r => num(r.months) >= 2)
                         .reduce((a, r) => a + num(r.total) / num(r.months), 0)
        return (
          <>
            <div className="grid" style={{ marginBottom: 14 }}>
              <div className="stat"><div className="n">{rows.length}</div><div className="l">vendors</div></div>
              <div className="stat"><div className="n">${money(tot)}</div><div className="l">booked in window</div></div>
              <div className="stat"><div className="n">${money(rate)}</div><div className="l">roughly per month</div></div>
              <div className="stat">
                <div className={'n ' + (pend ? 'warn' : 'pos')}>${money(pend)}</div>
                <div className="l">waiting to post</div>
              </div>
            </div>

            <div className="card">
              <table>
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th style={{ width: 70 }}>Entity</th>
                    <th style={{ width: 170 }}>Account</th>
                    <th className="num" style={{ width: 100 }}>Total</th>
                    <th className="num" style={{ width: 56 }}>Paid</th>
                    <th style={{ width: 100 }}>Last paid</th>
                    <th style={{ width: 150 }}>On card</th>
                    <th className="num" style={{ width: 110 }}>Waiting</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td><b>{r.vendor}</b></td>
                      <td><span className="pill">{r.business}</span></td>
                      <td style={{ fontSize: 12 }}>{r.gl_number} {r.gl_name}</td>
                      <td className="money">{num(r.total) ? '$' + money(r.total) : <span className="muted">—</span>}</td>
                      <td className="money">{num(r.payments) ? r.payments : <span className="muted">—</span>}</td>
                      <td>{r.last_paid || <span className="muted">—</span>}</td>
                      <td style={{ fontSize: 12 }}>{r.last_card || <span className="muted">—</span>}</td>
                      <td className="money">
                        {num(r.pending_total) ? (
                          <>
                            <span className="due-soon">${money(r.pending_total)}</span>
                            <div className="muted" style={{ fontSize: 10.5 }}>{r.pending_n} waiting</div>
                          </>
                        ) : <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td colSpan={3}>Total</td>
                    <td className="money">${money(tot)}</td>
                    <td colSpan={3} />
                    <td className="money">{pend ? '$' + money(pend) : ''}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {pend > 0 && (
              <div className="note warn">
                ${money(pend)} sits in Quick Review against a Subscriptions account and is not
                counted above. Post it and these totals move.
              </div>
            )}
          </>
        )
      })()}
    </div>
  )
}
