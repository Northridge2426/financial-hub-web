import { useCallback, useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money, shortDate } from './format.js'

/**
 * Payments due — next 30 days.  Port of the console's `paydue` pane.
 *
 * Three functions do the work, and the console passes them positionally in raw
 * SQL; through PostgREST they take named arguments instead:
 *   payments_due(p_days, p_business, p_back)   p_back defaults to 120, so the
 *                                              list reaches back four months
 *                                              and nothing quietly drops off
 *   payments_settled(p_days, p_business)       already ticked, or a payment of
 *                                              at least the minimum showed up
 *   mark_payment_paid(p_position, p_due, ...)  ticking only hides the line —
 *                                              nothing is posted to a ledger
 */
export default function PaymentsDue() {
  const [days, setDays] = useState(30)
  const [biz, setBiz] = useState('')
  const [entities, setEntities] = useState([])
  const [data, setData] = useState(null)      // { rows, settled }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [payday, setPayday] = useState(null)
  const [ticking, setTicking] = useState(null)

  useEffect(() => {
    supabase.from('businesses').select('code,name').eq('active', true).order('code')
      .then(({ data }) => setEntities(data || []))
  }, [])

  const run = useCallback(async (d = days, b = biz) => {
    setBusy(true); setErr('')
    try {
      const [rows, settled] = await Promise.all([
        rpc('payments_due', { p_days: Number(d), p_business: b || null }),
        rpc('payments_settled', { p_days: Number(d), p_business: b || null }),
      ])
      setData({ rows, settled })
    } catch (e) { setErr(e.message); setData(null) }
    setBusy(false)
  }, [days, biz])

  // Run on load and whenever a filter changes — the console makes you press Run,
  // but the query is cheap and a stale table beside a changed filter misleads.
  useEffect(() => { run(days, biz) }, [days, biz])   // eslint-disable-line

  async function untilPayDay() {
    setBusy(true); setErr('')
    try {
      const p = (await rpc('next_pay_day'))[0]
      const n = Math.max(0, Number(p.days_ahead))
      setPayday(p)
      setDays(n)
      // Fetch explicitly rather than leaning on the effect: if `n` equals the
      // current value the state never changes, the effect never fires, and the
      // button sits on "Reading…" for good.
      await run(n, biz)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  async function tick(row) {
    setTicking(row.position_id + row.due_date)
    try {
      await rpc('mark_payment_paid', {
        p_position: row.position_id,
        p_due: row.due_date,
        p_paid: true,
        p_note: 'Marked paid on the payments list',
      })
      await run()
    } catch (e) { setErr(e.message) }
    setTicking(null)
  }

  const rows = data?.rows ?? []
  const settled = data?.settled ?? []

  const total = rows.reduce((a, r) => a + Number(r.min_due || 0), 0)
  const auto = rows.filter(r => r.pay_method === 'Auto')
  const manual = rows.filter(r => r.pay_method !== 'Auto')
  const late = rows.filter(r => r.status === 'overdue')
  const lateOwing = late.filter(r => !r.nothing_owing)

  // What leaves each chequing account — the question behind the question.
  const byAcct = {}
  rows.forEach(r => {
    const k = r.funding || '— not set —'
    byAcct[k] = (byAcct[k] || 0) + Number(r.min_due || 0)
  })
  const accts = Object.keys(byAcct).sort((a, b) => byAcct[b] - byAcct[a])

  return (
    <div className="page">
      <p className="hint">
        Everything falling due in the window, oldest first, with the account it comes
        out of and whether it goes automatically.
      </p>

      <div className="bar">
        <label htmlFor="pdDays">Days ahead</label>
        <input id="pdDays" type="number" min="0" max="180" value={days} style={{ width: 76 }}
               onChange={e => setDays(e.target.value === '' ? 0 : Number(e.target.value))} />

        <button onClick={untilPayDay} disabled={busy}
                title="Only what falls due before the next pay lands.">
          Until next pay day
        </button>

        <select value={biz} onChange={e => setBiz(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>

        <button onClick={() => run()} disabled={busy}>{busy ? 'Reading…' : 'Refresh'}</button>
      </div>

      {err && <div className="err">{err}</div>}

      {payday && (
        <div className="note">
          Next pay lands <b>{shortDate(payday.pay_day)}</b> — read from {payday.observed} deposits,
          every {payday.cadence_days} days. Showing what falls due before then
          {Number(payday.days_ahead) > 0
            ? `, ${payday.days_ahead} day${Number(payday.days_ahead) === 1 ? '' : 's'}.`
            : ' — nothing further today.'}
        </div>
      )}

      {!data && !err && <div className="loading">Reading…</div>}

      {data && rows.length === 0 && (
        <div className="card">
          <div className="muted">
            Nothing due in the next {days} days, and nothing overdue.
            {settled.length > 0 && ` ${settled.length} already dealt with.`}
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="grid" style={{ marginBottom: 14 }}>
            <div className="stat"><div className="n">{rows.length}</div><div className="l">payments</div></div>
            <div className="stat"><div className="n">${money(total)}</div><div className="l">total due</div></div>
            <div className="stat"><div className="n">{auto.length}</div><div className="l">automatic</div></div>
            <div className="stat">
              <div className={'n ' + (manual.length ? 'warn' : 'pos')}>{manual.length}</div>
              <div className="l">you must pay</div>
            </div>
            <div className="stat">
              <div className={'n ' + (late.length ? 'neg' : 'pos')}>{late.length}</div>
              <div className="l">past due</div>
            </div>
          </div>

          {late.length > 0 && (
            <div className="note bad">
              <b>{late.length} past its due date and not ticked off.</b>{' '}
              {lateOwing.length
                ? lateOwing.map(r => `${r.name} $${money(r.min_due)} due ${r.due_date} (${-Number(r.days_to_due)} days ago)`).join(' · ')
                : 'All of them are watch dates with nothing owing.'}
              <div className="fine">
                These are the ones the list used to drop. A payment set to <b>Auto</b> clears itself
                once the day passes; anything <b>Manual</b> — or with no method set — stays here
                until you tick it, because only you know whether it actually went.
              </div>
            </div>
          )}

          <div className="note">
            <b>Leaving each account:</b>{' '}
            {accts.map((k, i) => (
              <span key={k}>{i > 0 && ' · '}{k} <b>${money(byAcct[k])}</b></span>
            ))}
          </div>

          <div className="card">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 44 }} title="Tick when you have paid it, or when you have confirmed the automatic payment went. It leaves the list — nothing reaches a ledger.">Paid</th>
                  <th style={{ width: 104 }}>Due</th>
                  <th style={{ width: 62 }}>In</th>
                  <th>Account</th>
                  <th style={{ width: 120 }}>Class</th>
                  <th className="num" style={{ width: 100 }}>Minimum</th>
                  <th className="num" style={{ width: 110 }}>Balance</th>
                  <th className="num" style={{ width: 62 }}>Rate</th>
                  <th style={{ width: 180 }}>Paid from</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const key = r.position_id + r.due_date
                  const isLate = r.status === 'overdue'
                  const urgent = !isLate && Number(r.days_to_due) <= 3
                  const cls = isLate ? 'due-late' : urgent ? 'due-soon' : ''
                  return (
                    <tr key={key} className={isLate ? 'row-late' : ''}
                        style={r.nothing_owing ? { opacity: 0.6 } : undefined}>
                      <td>
                        <input type="checkbox" checked={false} disabled={ticking === key}
                               onChange={() => tick(r)}
                               title="Tick when it is paid — this line goes away, nothing is posted." />
                      </td>
                      <td className={cls}>{r.due_date}</td>
                      <td className={cls}>
                        {isLate ? `${-Number(r.days_to_due)}d ago` : `${r.days_to_due}d`}
                      </td>
                      <td>
                        <b>{r.name}</b> <span className="pill">{r.business}</span>
                        {r.nothing_owing && (
                          <span className="pill soft" title="A payment date you watch, but there is nothing owing on it.">
                            nothing owing
                          </span>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>{r.class_label}</td>
                      <td className="money">
                        {r.nothing_owing ? '—' : <b>${money(r.min_due)}</b>}
                      </td>
                      <td className="money">${money(r.owed)}</td>
                      <td className="money">
                        {r.effective_rate ? (Number(r.effective_rate) * 100).toFixed(2) + '%' : ''}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {r.funding || <span className="muted">not set</span>}
                        {r.pay_method && (
                          <span className={'pill ' + (r.pay_method === 'Auto' ? 'soft' : 'hold')}>
                            {r.pay_method}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                <tr className="total">
                  <td colSpan={5}>Total</td>
                  <td className="money">${money(total)}</td>
                  <td colSpan={3} />
                </tr>
              </tbody>
            </table>
          </div>

          {settled.length > 0 && (
            <div className="note good">
              <b>{settled.length} already dealt with in this window</b> —{' '}
              {settled.map((g, i) => (
                <span key={i}>
                  {i > 0 && ' · '}{g.name} {g.due_date}
                  <span className="pill soft">{g.how === 'ticked' ? 'ticked' : `seen: ${g.note}`}</span>
                </span>
              ))}
              <div className="fine">
                Ones you ticked, and ones where a payment of at least the minimum already shows on
                the account near the due date. Nothing was posted for either — the ledger learns
                about a payment when its bank row arrives.
              </div>
            </div>
          )}

          {manual.length > 0 ? (
            <div className="note warn">
              <b>These do not pay themselves:</b>{' '}
              {manual.map((r, i) => (
                <span key={r.position_id + r.due_date}>
                  {i > 0 && ' · '}
                  {r.nothing_owing
                    ? `${r.name} on ${r.due_date} — nothing owing, but worth a look`
                    : <>{r.name} <b>${money(r.min_due)}</b> on {r.due_date}</>}
                </span>
              ))}
            </div>
          ) : (
            <p className="hint">Everything in this window is on autopay.</p>
          )}

          <p className="hint">
            Showing everything from 120 days back to {days} days ahead. Nothing disappears on its
            own except an <b>Auto</b> payment whose date has gone by.
          </p>
        </>
      )}
    </div>
  )
}
