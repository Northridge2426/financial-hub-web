import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { money } from './format.js'

const num = v => Number(v) || 0
const signed = v => (num(v) < 0 ? '−$' : '$') + money(Math.abs(num(v)))

/**
 * Bank balance verification — does each statement period tie?
 *
 * Opening + movement should equal closing. Where it doesn't, either the
 * transactions are incomplete or a balance was misread. "No balances" is a
 * third state and not a failure: the statement's own figures were never parsed,
 * so there is nothing to check against.
 */
export default function BankVerification() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [onlyOff, setOnlyOff] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const [sum, per] = await Promise.all([
          supabase.from('v_bank_reconciliation_summary')
            .select('account,kind,business,periods,clean,off,accepted,unparsed,empty_periods,total_difference,last_clean,txns,reviewed')
            .order('off', { ascending: false }).order('unparsed', { ascending: false }).order('account'),
          supabase.from('v_bank_reconciliation')
            .select('statement_id,account,period_start,period_end,opening_balance,closing_balance,movement,difference,txns,reviewed,status')
            .order('account').order('period_end'),
        ])
        if (sum.error) throw new Error(sum.error.message)
        if (per.error) throw new Error(per.error.message)
        setData({ sum: sum.data || [], per: per.data || [] })
      } catch (e) { setErr(e.message) }
    })()
  }, [])

  if (err) return <div className="page"><div className="err">{err}</div></div>
  if (!data) return <div className="page"><div className="loading">Loading…</div></div>

  const { sum, per } = data
  const tot = sum.reduce((a, r) => ({
    p: a.p + num(r.periods), c: a.c + num(r.clean),
    o: a.o + num(r.off), u: a.u + num(r.unparsed),
  }), { p: 0, c: 0, o: 0, u: 0 })

  const isOff = r => r.status !== 'balanced' && r.status !== 'no balances'
  const accounts = sum.filter(s => !onlyOff || num(s.off) || num(s.unparsed))

  return (
    <div className="page">
      <p className="hint">
        Opening plus movement should equal closing, for every period of every account. Where it
        doesn't, either the transactions are incomplete or a balance was misread — the difference
        says which is more likely by its size.
      </p>

      <div className="bar">
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyOff} style={{ width: 'auto' }}
                 onChange={e => setOnlyOff(e.target.checked)} />
          Only what doesn't tie
        </label>
      </div>

      <div className="grid" style={{ marginBottom: 14 }}>
        <div className="stat"><div className="n pos">{tot.c}</div><div className="l">periods tie</div></div>
        <div className="stat">
          <div className={'n ' + (tot.o ? 'neg' : 'pos')}>{tot.o}</div>
          <div className="l">don't tie</div>
        </div>
        <div className="stat">
          <div className={'n ' + (tot.u ? 'warn' : 'pos')}>{tot.u}</div>
          <div className="l">no balance read</div>
        </div>
        <div className="stat"><div className="n">{tot.p}</div><div className="l">periods checked</div></div>
      </div>

      {accounts.map(s => {
        const rows = per.filter(r => r.account === s.account)
                        .filter(r => !onlyOff || isOff(r) || r.status === 'no balances')
        if (!rows.length) return null
        const bad = num(s.off), un = num(s.unparsed)
        return (
          <div className="card" key={s.account}>
            <h2>
              {s.account}{' '}
              <span className="pill">{String(s.kind || '').replace('_', ' ')}</span>
              {s.business && <span className="pill">{s.business}</span>}
              {bad ? <span className="pill hold">{bad} out</span>
                : un ? <span className="pill hold">{un} unread</span>
                : <span className="pill soft">reconciled</span>}
            </h2>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              {s.clean} of {s.periods} periods tie · {s.txns} transactions
              {num(s.total_difference) !== 0 && <> · {signed(s.total_difference)} out in total</>}
              {s.last_clean && <> · last clean {s.last_clean}</>}
            </div>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 180 }}>Period</th>
                  <th className="num" style={{ width: 110 }}>Opening</th>
                  <th className="num" style={{ width: 110 }}>Movement</th>
                  <th className="num" style={{ width: 110 }}>Closing</th>
                  <th className="num" style={{ width: 110 }}>Difference</th>
                  <th className="num" style={{ width: 60 }}>Txns</th>
                  <th style={{ width: 120 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.statement_id} className={isOff(r) ? 'row-late' : ''}>
                    <td>{r.period_start} → {r.period_end}</td>
                    <td className="money">{signed(r.opening_balance)}</td>
                    <td className="money">{signed(r.movement)}</td>
                    <td className="money">{signed(r.closing_balance)}</td>
                    <td className={'money ' + (Math.abs(num(r.difference)) > 0.005 ? 'neg' : 'muted')}>
                      {num(r.difference) ? signed(r.difference) : '—'}
                    </td>
                    <td className="money">{r.txns}</td>
                    <td>
                      <span className={'pill ' + (r.status === 'balanced' ? 'soft'
                                                : r.status === 'no balances' ? '' : 'hold')}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}

      {accounts.length === 0 && (
        <div className="card"><div className="muted">Everything ties.</div></div>
      )}
    </div>
  )
}
