import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money, today } from './format.js'
import { useEntities } from './useEntities.js'

const num = v => Number(v) || 0
const signed = v => (num(v) < 0 ? '−$' : '$') + money(Math.abs(num(v)))

/**
 * Cash flow — not a conventional statement of cash flows. There is no
 * "operations / investing / financing". Cash here is the bank, savings and till
 * accounts; every other account is shown as its EFFECT on that cash.
 *
 * Three functions: the movement itself, a bridge proving it against the bank,
 * and whatever could not be attributed.
 */
export default function CashFlow() {
  const [biz, setBiz] = useState('')
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState(today())
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const entities = useEntities()

  useEffect(() => {
    setData(null); setErr('')
    const args = { p_business: biz || null, p_from: from, p_to: to }
    Promise.all([
      rpc('cash_flow', args),
      rpc('cash_flow_bridge', args),
      rpc('cash_flow_unallocated', args),
    ])
      .then(([flow, bridge, unalloc]) => setData({ flow, bridge, unalloc }))
      .catch(e => setErr(e.message))
  }, [biz, from, to])

  return (
    <div className="page">
      <p className="hint">
        Not a conventional statement of cash flows — there is no operations / investing /
        financing. Cash is the bank, savings and till accounts; everything else is shown as its
        <b> effect</b> on that cash. A card purchase therefore appears twice over: once as the
        expense that used the money, once as the card balance that has not been paid yet.
      </p>

      <div className="bar">
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">All entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        <label htmlFor="cfFrom">From</label>
        <input id="cfFrom" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label htmlFor="cfTo">To</label>
        <input id="cfTo" type="date" value={to} onChange={e => setTo(e.target.value)} />
      </div>

      {err && <div className="err">{err}</div>}
      {!data && !err && <div className="loading">Running…</div>}

      {data && (() => {
        const { flow, bridge, unalloc } = data
        const groups = []
        for (const r of [...flow].sort((a, b) => (a.group_sort - b.group_sort))) {
          let g = groups.find(x => x.code === r.group_code)
          if (!g) { g = { code: r.group_code, label: r.group_label, rows: [] }; groups.push(g) }
          g.rows.push(r)
        }
        const net = flow.reduce((a, r) => a + num(r.amount), 0)
        const bankMove = bridge.reduce((a, r) => a + num(r.bank_move), 0)
        const timing = bridge.reduce((a, r) => a + num(r.timing_diff), 0)
        const uncoded = bridge.reduce((a, r) => a + num(r.uncoded), 0)

        return (
          <>
            <div className="grid" style={{ marginBottom: 14 }}>
              <div className="stat">
                <div className={'n ' + (net < 0 ? 'neg' : 'pos')}>{signed(net)}</div>
                <div className="l">net movement</div>
              </div>
              <div className="stat">
                <div className={'n ' + (bankMove < 0 ? 'neg' : 'pos')}>{signed(bankMove)}</div>
                <div className="l">the bank actually moved</div>
              </div>
              <div className="stat">
                <div className={'n ' + (Math.abs(timing) > 0.005 ? 'warn' : 'pos')}>{signed(timing)}</div>
                <div className="l">timing difference</div>
              </div>
              <div className="stat">
                <div className={'n ' + (Math.abs(uncoded) > 0.005 ? 'warn' : 'pos')}>{signed(uncoded)}</div>
                <div className="l">still uncoded</div>
              </div>
            </div>

            {groups.map(g => (
              <div className="card" key={g.code}>
                <h2>{g.label}</h2>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 62 }}>Entity</th>
                      <th style={{ width: 80 }}>Number</th>
                      <th>Account</th>
                      <th style={{ width: 200 }}>Basis</th>
                      <th className="num" style={{ width: 120 }}>Effect on cash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r, i) => (
                      <tr key={i}>
                        <td><span className="pill">{r.business}</span></td>
                        <td className="muted">{r.number}</td>
                        <td>
                          {r.name}
                          {r.is_override && (
                            <span className="pill hold" title="Classified by hand, not by rule.">override</span>
                          )}
                        </td>
                        <td className="muted" style={{ fontSize: 11.5 }}>{r.basis || ''}</td>
                        <td className={'money ' + (num(r.amount) < 0 ? 'neg' : '')}>
                          {signed(r.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td colSpan={4}>{g.label} total</td>
                      <td className="money">
                        {signed(g.rows.reduce((a, r) => a + num(r.amount), 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}

            <div className="card">
              <h2>Proving it against the bank</h2>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 62 }}>Entity</th>
                    <th>Account</th>
                    <th className="num" style={{ width: 110 }}>Opening</th>
                    <th className="num" style={{ width: 110 }}>Closing</th>
                    <th className="num" style={{ width: 110 }}>Bank moved</th>
                    <th className="num" style={{ width: 110 }}>Ledger moved</th>
                    <th className="num" style={{ width: 100 }}>Uncoded</th>
                    <th className="num" style={{ width: 100 }}>Timing</th>
                  </tr>
                </thead>
                <tbody>
                  {bridge.map((r, i) => (
                    <tr key={i}>
                      <td><span className="pill">{r.business}</span></td>
                      <td>
                        {r.account_name || r.name}
                        {!r.has_bank && (
                          <span className="pill hold" title="No statement balance to check against.">
                            no bank figure
                          </span>
                        )}
                      </td>
                      <td className="money">{signed(r.bank_open)}</td>
                      <td className="money">{signed(r.bank_close)}</td>
                      <td className="money">{signed(r.bank_move)}</td>
                      <td className="money">{signed(r.ledger_move)}</td>
                      <td className={'money ' + (Math.abs(num(r.uncoded)) > 0.005 ? 'due-soon' : '')}>
                        {num(r.uncoded) ? signed(r.uncoded) : ''}
                      </td>
                      <td className={'money ' + (Math.abs(num(r.timing_diff)) > 0.005 ? 'due-soon' : '')}>
                        {num(r.timing_diff) ? signed(r.timing_diff) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint" style={{ margin: '8px 0 0' }}>
                A timing difference is a real movement the ledger has not caught up with yet.
                An uncoded figure is money that moved without anyone saying what it was for.
              </p>
            </div>

            {unalloc.length > 0 && (
              <div className="card">
                <h2>What could not be attributed</h2>
                <table>
                  <thead>
                    <tr>
                      <th>Reason</th>
                      <th style={{ width: 62 }}>Entity</th>
                      <th>Account</th>
                      <th className="num" style={{ width: 60 }}>Count</th>
                      <th className="num" style={{ width: 120 }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...unalloc].sort((a, b) => a.reason_sort - b.reason_sort).map((r, i) => (
                      <tr key={i}>
                        <td>{r.reason_label}</td>
                        <td><span className="pill">{r.business}</span></td>
                        <td className="muted">{r.account_name}</td>
                        <td className="money">{r.n}</td>
                        <td className="money">{signed(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      })()}
    </div>
  )
}
