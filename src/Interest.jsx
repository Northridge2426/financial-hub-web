import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money, today } from './format.js'

const num = v => Number(v) || 0
/** Signed money, minus sign rendered as a true minus rather than a hyphen. */
const signed = v => (num(v) < 0 ? '−$' : '$') + money(Math.abs(num(v)))

export default function Interest() {
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState(today())
  const [mode, setMode] = useState('shift')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setRows(null); setErr('')
    // NOT interest_by_balance directly: it builds a temp table and runs
    // `delete from _w;` with no WHERE, which Supabase's safeupdate guard blocks
    // for the authenticated role. The wrapper is SECURITY DEFINER (exempt) and
    // checks is_app_user() itself, so RLS is not weakened.
    rpc('web_interest_by_balance', { p_from: from, p_to: to, p_owner_mode: mode })
      .then(setRows).catch(e => setErr(e.message))
  }, [from, to, mode])

  return (
    <div className="page">
      <p className="hint">
        Interest against the spending that generated it. Interest is charged on a <b>balance</b>,
        so the weight is the balance each entity carries — not what it happened to spend.
      </p>

      <div className="bar">
        <label htmlFor="iFrom">From</label>
        <input id="iFrom" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label htmlFor="iTo">To</label>
        <input id="iTo" type="date" value={to} onChange={e => setTo(e.target.value)} />
        <select value={mode} onChange={e => setMode(e.target.value)}
                title="How a payment made from a personal account onto a business card is weighted.">
          <option value="shift">Owner picks up the weight</option>
          <option value="hold">Owner gains no weight</option>
        </select>
      </div>

      {err && <div className="err">{err}</div>}
      {!rows && !err && <div className="loading">Analysing…</div>}
      {rows && rows.length === 0 && (
        <div className="card"><div className="muted">No interest categorised in that period.</div></div>
      )}

      {rows && rows.length > 0 && (() => {
        const sum = k => rows.reduce((a, r) => a + num(r[k]), 0)
        const charged = num(rows[0].period_interest_charged)
        const exPersonal = rows.filter(r => r.business !== 'PER')
                               .reduce((a, r) => a + num(r.over_under), 0)
        const unallocated = Math.round((charged - sum('interest_should_be')) * 100) / 100

        return (
          <>
            <div className="card">
              <table>
                <thead>
                  <tr>
                    <th>Business</th>
                    <th className="num">Average balance carried</th>
                    <th className="num" style={{ width: 70 }}>Share</th>
                    <th className="num">Owner contributions</th>
                    <th className="num">Interest booked</th>
                    <th className="num">Proportional share</th>
                    <th className="num">Over / under</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.business}>
                      <td>
                        <b>{r.business}</b>
                        <div className="muted" style={{ fontSize: 10.5 }}>
                          {r.months} month{num(r.months) === 1 ? '' : 's'}, {r.cards} card{num(r.cards) === 1 ? '' : 's'}
                        </div>
                      </td>
                      <td className="money">{signed(r.avg_weighted_balance)}</td>
                      <td className="money">{Number(r.pct_of_weight).toFixed(1)}%</td>
                      <td className="money">{num(r.owner_contributions) ? signed(r.owner_contributions) : ''}</td>
                      <td className="money">{signed(r.interest_booked)}</td>
                      <td className="money">{signed(r.interest_should_be)}</td>
                      <td className={'money ' + (num(r.over_under) < 0 ? 'neg' : num(r.over_under) > 0 ? 'pos' : 'muted')}>
                        {signed(r.over_under)}
                      </td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>All</td>
                    <td className="money">{signed(sum('avg_weighted_balance'))}</td>
                    <td className="money">100.0%</td>
                    <td className="money">{signed(sum('owner_contributions'))}</td>
                    <td className="money">{signed(sum('interest_booked'))}</td>
                    <td className="money">{signed(sum('interest_should_be'))}</td>
                    <td className="money">{signed(sum('over_under'))}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className={'note ' + (exPersonal < 0 ? 'bad' : 'good')}>
              Excluding Personal, interest is{' '}
              <b>{exPersonal < 0 ? 'understated' : 'overstated'} by {signed(Math.abs(exPersonal))}</b>{' '}
              against each business's share of the spending that generated it.
            </div>

            {Math.abs(unallocated) > 0.005 && (
              <div className="note warn">
                <b>{signed(unallocated)}</b> of the interest charged in this period is not carried
                by any entity's weight.
              </div>
            )}

            <div className="note">
              <b>How that figure is worked out.</b>
              <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
                <li>Each card starts the year with its opening balance on the <b>owner's</b> weight.
                    Before 2026 the card was the owner's to carry, and the sealed year says nothing
                    finer.</li>
                <li>Each month, an entity's weight rises by what it <b>spent</b> on that card and by
                    the interest it was charged, and falls when it <b>pays the card down itself</b>.</li>
                <li>A payment made from a <b>personal</b> account onto a <b>business</b> card is an{' '}
                    <b>owner contribution</b>. The business keeps its weight — the debt is still
                    being carried, just by the owner now.{' '}
                    {mode === 'shift'
                      ? 'Personal picks that weight up, because Personal is financing the same principal.'
                      : 'Personal gains no weight from it.'}</li>
              </ol>
            </div>
          </>
        )
      })()}
    </div>
  )
}
