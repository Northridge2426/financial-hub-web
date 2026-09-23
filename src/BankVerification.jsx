import { useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
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
 *
 * A period that will never tie can be ACCEPTED, with a reason. The reason is
 * required and is kept with the statement, so that in six months nobody has to
 * work out again why September was out by $1,024 — and so that "accepted" never
 * silently means "gave up". Accepting is reversible from the same row.
 */
export default function BankVerification() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [onlyOff, setOnlyOff] = useState(false)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [asking, setAsking] = useState(null)   // statement_id awaiting a reason
  const [why, setWhy] = useState('')

  const load = async () => {
      try {
        const [sum, per] = await Promise.all([
          supabase.from('v_bank_reconciliation_summary')
            .select('account,kind,business,periods,clean,off,accepted,unparsed,empty_periods,total_difference,last_clean,txns,reviewed')
            .order('off', { ascending: false }).order('unparsed', { ascending: false }).order('account'),
          supabase.from('v_bank_reconciliation')
            .select('statement_id,account,period_start,period_end,opening_balance,closing_balance,movement,difference,txns,reviewed,status,accepted_at,accepted_reason')
            .order('account').order('period_end'),
        ])
        if (sum.error) throw new Error(sum.error.message)
        if (per.error) throw new Error(per.error.message)
        setData({ sum: sum.data || [], per: per.data || [] })
      } catch (e) { setErr(e.message) }
  }

  useEffect(() => { load() }, [])

  async function accept(sid) {
    if (!why.trim()) { setErr('A reason is required — that is the point of accepting.'); return }
    setBusy(sid); setErr(''); setMsg('')
    try {
      await rpc('accept_statement', { p_statement: sid, p_reason: why.trim() })
      setMsg('Recorded, with the reason kept against the statement.')
      setAsking(null); setWhy('')
      await load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  async function unaccept(sid) {
    setBusy(sid); setErr(''); setMsg('')
    try {
      await rpc('unaccept_statement', { p_statement: sid })
      setMsg('Reopened — the period counts as out again.')
      await load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  if (err && !data) return <div className="page"><div className="err">{err}</div></div>
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

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

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
                  <th style={{ width: 150 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => [
                  <tr key={r.statement_id} className={isOff(r) && !r.accepted_at ? 'row-late' : ''}>
                    <td>{r.period_start} → {r.period_end}</td>
                    <td className="money">{signed(r.opening_balance)}</td>
                    <td className="money">{signed(r.movement)}</td>
                    <td className="money">{signed(r.closing_balance)}</td>
                    <td className={'money ' + (Math.abs(num(r.difference)) > 0.005 ? 'neg' : 'muted')}>
                      {num(r.difference) ? signed(r.difference) : '—'}
                    </td>
                    <td className="money">{r.txns}</td>
                    <td>
                      {r.accepted_at
                        ? <span className="pill" title={r.accepted_reason || ''}>accepted</span>
                        : <span className={'pill ' + (r.status === 'balanced' ? 'soft'
                                                    : r.status === 'no balances' ? '' : 'hold')}>
                            {r.status}
                          </span>}
                    </td>
                    <td>
                      {r.accepted_at ? (
                        <button disabled={busy === r.statement_id}
                                style={{ padding: '1px 8px', fontSize: 11 }}
                                title="The period counts as out again."
                                onClick={() => unaccept(r.statement_id)}>
                          reopen
                        </button>
                      ) : Math.abs(num(r.difference)) > 0.005 ? (
                        <button disabled={busy === r.statement_id}
                                style={{ padding: '1px 8px', fontSize: 11 }}
                                onClick={() => { setAsking(asking === r.statement_id ? null : r.statement_id); setWhy('') }}>
                          {asking === r.statement_id ? 'cancel' : 'accept…'}
                        </button>
                      ) : null}
                    </td>
                  </tr>,
                  asking === r.statement_id && (
                    <tr key={r.statement_id + '-ask'} className="expand">
                      <td colSpan={9}>
                        <div className="bar" style={{ margin: 0 }}>
                          <span style={{ fontSize: 12.5 }}>
                            Why is {r.account} {r.period_end} out by {signed(r.difference)}?
                          </span>
                          <input value={why} onChange={e => setWhy(e.target.value)}
                                 placeholder="e.g. a deposit in transit at month end"
                                 style={{ flex: 1, minWidth: 260 }}
                                 onKeyDown={e => { if (e.key === 'Enter') accept(r.statement_id) }} />
                          <button className="primary" disabled={!why.trim() || busy === r.statement_id}
                                  onClick={() => accept(r.statement_id)}>
                            {busy === r.statement_id ? 'Recording…' : 'Accept the difference'}
                          </button>
                        </div>
                        <p className="hint" style={{ margin: '4px 0 0' }}>
                          The reason is kept with the statement, so nobody has to work it out again.
                        </p>
                      </td>
                    </tr>
                  ),
                ])}
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
