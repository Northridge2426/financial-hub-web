import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { money } from './format.js'

const num = v => Number(v) || 0
const CARDISH = ['credit_card', 'loan']

export default function StatementsDue() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const [exp, gaps] = await Promise.all([
          supabase.from('v_statement_expectations')
            .select('account,kind,business,last_statement,cadence_days,expected_next,days_late,statements_held,latest_balance,payment_due_date,minimum_payment,status')
            .order('days_late', { ascending: false }),
          supabase.from('v_statement_gaps')
            .select('account,business,gap_from,gap_to,days_missing')
            .order('account').order('gap_from'),
        ])
        if (exp.error) throw new Error(exp.error.message)
        if (gaps.error) throw new Error(gaps.error.message)
        setData({ exp: exp.data || [], gaps: gaps.data || [] })
      } catch (e) { setErr(e.message) }
    })()
  }, [])

  if (err) return <div className="page"><div className="err">{err}</div></div>
  if (!data) return <div className="page"><div className="loading">Loading…</div></div>

  const { exp, gaps } = data
  const late = exp.filter(r => r.status !== 'current')
  const owed = exp.filter(r => CARDISH.includes(r.kind)).reduce((a, r) => a + num(r.latest_balance), 0)
  const held = exp.filter(r => !CARDISH.includes(r.kind)).reduce((a, r) => a + num(r.latest_balance), 0)

  return (
    <div className="page">
      <p className="hint">
        What should have arrived by now. A statement is chased on its own cadence, so a card that
        bills monthly and a loan that bills quarterly are both judged against their own rhythm.
      </p>

      <div className="grid" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className={'n ' + (late.length ? 'warn' : 'pos')}>{late.length}</div>
          <div className="l">due or overdue</div>
        </div>
        <div className="stat">
          <div className={'n ' + (gaps.length ? 'warn' : 'pos')}>{gaps.length}</div>
          <div className="l">missing mid-run</div>
        </div>
        <div className="stat"><div className="n">${money(held)}</div><div className="l">in accounts</div></div>
        <div className="stat"><div className="n neg">${money(owed)}</div><div className="l">owed on cards and loans</div></div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th style={{ width: 62 }}>Entity</th>
              <th style={{ width: 150 }}>Last statement</th>
              <th className="num" style={{ width: 66 }}>Every</th>
              <th style={{ width: 110 }}>Expected next</th>
              <th className="num" style={{ width: 120 }}>Latest balance</th>
              <th style={{ width: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {exp.map((r, i) => (
              <tr key={i} className={r.status === 'overdue' ? 'row-late' : ''}>
                <td>
                  <b>{r.account}</b>{' '}
                  <span className="muted">{String(r.kind || '').replace('_', ' ')}</span>
                </td>
                <td>{r.business && <span className="pill">{r.business}</span>}</td>
                <td>
                  {r.last_statement}
                  <span className="muted" style={{ fontSize: 11 }}> · {r.statements_held} held</span>
                </td>
                <td className="money">{r.cadence_days}d</td>
                <td>{r.expected_next}</td>
                <td className="money">${money(r.latest_balance)}</td>
                <td>
                  <span className={'pill ' + (r.status === 'overdue' ? 'hold'
                                            : r.status === 'due' ? '' : 'soft')}>
                    {num(r.days_late) > 0
                      ? `${r.days_late} day${num(r.days_late) === 1 ? '' : 's'} late`
                      : r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {gaps.length > 0 && (
        <div className="card">
          <h2>Missing from the middle</h2>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th style={{ width: 62 }}>Entity</th>
                <th style={{ width: 120 }}>From</th>
                <th style={{ width: 120 }}>To</th>
                <th className="num" style={{ width: 110 }}>Days missing</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g, i) => (
                <tr key={i}>
                  <td><b>{g.account}</b></td>
                  <td>{g.business && <span className="pill">{g.business}</span>}</td>
                  <td>{g.gap_from}</td>
                  <td>{g.gap_to}</td>
                  <td className="money">{g.days_missing}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ margin: '8px 0 0' }}>
            A gap between two statements you <i>do</i> hold is worse than a late one — the balance
            either side proves something happened in between that nothing has accounted for.
          </p>
        </div>
      )}
    </div>
  )
}
