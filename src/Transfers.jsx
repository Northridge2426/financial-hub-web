import { useCallback, useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money, today } from './format.js'

const num = v => Number(v) || 0

/**
 * Transfers and payments — money moving between your own accounts, however the
 * bank described it.
 *
 * `transfer_match_plan` proposes pairs. Accepting one posts BOTH legs, so the
 * proposed coding is shown on the row rather than hidden behind a preview: you
 * should be able to read what will be posted without clicking anything.
 *
 * A leg with no counterparty is not a failure. It can be a payment to something
 * outside the accounts you track, in which case it is recorded one-sided, sent
 * to a GL account, or — if it turned out not to be a transfer at all — pushed
 * back to the expense queues.
 */
export default function Transfers() {
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState(today())
  const [window, setWindow] = useState(45)
  const [plan, setPlan] = useState(null)
  const [legs, setLegs] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [glAccounts, setGlAccounts] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [alts, setAlts] = useState(null)        // { legId, rows }
  const [choice, setChoice] = useState({})      // legId -> { mode, target, note }

  useEffect(() => {
    supabase.from('accounts').select('id,name').eq('active', true).order('name')
      .then(({ data }) => setAccounts(data || []))
    supabase.from('v_gl_accounts_with_activity').select('id,business,number,name')
      .order('business').order('number')
      .then(({ data }) => setGlAccounts(data || []))
  }, [])

  const load = useCallback(async () => {
    setErr(''); setPlan(null); setLegs(null); setAlts(null)
    try {
      const args = { p_from: from, p_to: to, p_window: Number(window) }
      const [p, l] = await Promise.all([
        rpc('web_transfer_match_plan', args),
        rpc('web_tp_unmatched', args),
      ])
      setPlan(p.filter(r => !r.already_paired))
      setLegs(l)
    } catch (e) { setErr(e.message) }
  }, [from, to, window])

  useEffect(() => { load() }, [load])

  async function act(key, fn, okMsg) {
    setBusy(key); setErr(''); setMsg('')
    try {
      const res = await fn()
      setMsg(typeof res === 'string' ? res : (okMsg || 'Done.'))
      await load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  async function showAlts(legId) {
    if (alts && alts.legId === legId) { setAlts(null); return }
    setAlts({ legId, rows: null })
    try {
      setAlts({ legId, rows: await rpc('tp_alternatives', { p_leg: legId, p_window: Number(window) }) })
    } catch (e) { setErr(e.message); setAlts(null) }
  }

  const setChoiceFor = (id, patch) =>
    setChoice(c => ({ ...c, [id]: { ...(c[id] || { mode: '' }), ...patch } }))

  return (
    <div className="page">
      <p className="hint">
        Money moving between your own accounts. Accepting a match posts <b>both</b> legs, so the
        coding it would use is printed on the row — you should not have to click to find out what
        will happen.
      </p>

      <div className="bar">
        <label htmlFor="tpFrom">From</label>
        <input id="tpFrom" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label htmlFor="tpTo">To</label>
        <input id="tpTo" type="date" value={to} onChange={e => setTo(e.target.value)} />
        <label htmlFor="tpWin">Within</label>
        <input id="tpWin" type="number" min="1" max="120" value={window} style={{ width: 70 }}
               onChange={e => setWindow(e.target.value)} />
        <span className="muted" style={{ fontSize: 12 }}>days</span>
      </div>

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}
      {(!plan || !legs) && !err && <div className="loading">Reading…</div>}

      {plan && legs && (
        <div className="grid" style={{ marginBottom: 14 }}>
          <div className="stat">
            <div className={'n ' + (plan.length ? 'warn' : 'pos')}>{plan.length}</div>
            <div className="l">proposed matches</div>
          </div>
          <div className="stat">
            <div className={'n ' + (legs.length ? 'warn' : 'pos')}>{legs.length}</div>
            <div className="l">legs with no counterparty</div>
          </div>
          <div className="stat">
            <div className="n">{plan.filter(r => r.cross_entity).length}</div>
            <div className="l">across entities</div>
          </div>
          <div className="stat">
            <div className="n">{plan.filter(r => num(r.candidates) > 1).length}</div>
            <div className="l">with more than one candidate</div>
          </div>
        </div>
      )}

      {/* ---------- proposed matches ---------- */}
      {plan && plan.length > 0 && (
        <div className="card">
          <h2>Proposed matches</h2>
          {plan.map(r => (
            <div className="note" key={r.leg_id + r.cpty_id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <b>${money(r.leg_amount)}</b>
                <span className="muted">{r.leg_ref} {r.leg_account} ({r.leg_date})</span>
                <span>↔</span>
                <span className="muted">{r.cpty_ref} {r.cpty_account} ({r.cpty_date})</span>
                <span className={'pill ' + (num(r.confidence) >= 80 ? 'soft' : 'hold')}>
                  {r.confidence}%
                </span>
                {r.cross_entity && <span className="pill hold">across entities</span>}
                {num(r.candidates) > 1 && (
                  <span className="pill hold">{r.candidates} candidates</span>
                )}
                {r.cpty_booked && (
                  <span className="pill" title="The other side already carries an entry.">
                    other side booked
                  </span>
                )}
              </div>

              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{r.why}</div>
              {r.coding && (
                <div style={{ fontSize: 12, marginTop: 3, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                  {r.coding}
                </div>
              )}

              <div className="bar" style={{ margin: '8px 0 0' }}>
                <button className="primary" disabled={!!busy}
                        onClick={() => act(r.leg_id + 'a',
                          () => rpc('tp_accept', { p_a: r.leg_id, p_b: r.cpty_id }),
                          'Paired and posted.')}>
                  {busy === r.leg_id + 'a' ? 'Posting…' : 'Accept — post both legs'}
                </button>
                <button disabled={!!busy}
                        onClick={() => act(r.leg_id + 'd',
                          () => rpc('tp_decline', {
                            p_a: r.leg_id, p_b: r.cpty_id,
                            p_note: 'Declined on the web console',
                          }), 'Declined.')}>
                  Not a pair
                </button>
                <button onClick={() => showAlts(r.leg_id)}>
                  {alts && alts.legId === r.leg_id ? 'Hide alternatives' : 'Other candidates'}
                </button>
              </div>

              {alts && alts.legId === r.leg_id && (
                <Alternatives alts={alts} legId={r.leg_id} busy={busy} act={act} />
              )}
            </div>
          ))}
        </div>
      )}

      {plan && plan.length === 0 && (
        <div className="card"><div className="muted">Nothing left to pair in this window.</div></div>
      )}

      {/* ---------- legs with no counterparty ---------- */}
      {legs && legs.length > 0 && (
        <div className="card">
          <h2>No counterparty found</h2>
          <p className="hint">
            Not a failure — the other side may be outside the accounts you track. Record it
            one-sided, send it to a general ledger account, or push it back to the expense queues
            if it was never a transfer.
          </p>

          {legs.map(l => {
            const c = choice[l.leg_id] || { mode: '' }
            return (
              <div className="note" key={l.leg_id} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <b>{l.leg_direction === 'inflow' ? '+' : '−'}${money(l.leg_amount)}</b>
                  <span className="muted">{l.leg_ref}</span>
                  <span>{l.leg_account}</span>
                  <span className="pill">{l.leg_business}</span>
                  <span className="muted">{l.leg_date}</span>
                  {num(l.near_misses) > 0 && (
                    <span className="pill hold">{l.near_misses} near miss{num(l.near_misses) === 1 ? '' : 'es'}</span>
                  )}
                  {l.leg_stmt && <span className="pill soft">stmt</span>}
                </div>
                <div style={{ fontSize: 12, marginTop: 2 }}>{l.leg_descr}</div>
                {l.suggestion && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{l.suggestion}</div>
                )}

                <div className="bar" style={{ margin: '8px 0 0', flexWrap: 'wrap' }}>
                  <select value={c.mode} onChange={e => setChoiceFor(l.leg_id, { mode: e.target.value, target: '' })}>
                    <option value="">What is it?</option>
                    <option value="one">The other side is an account I hold</option>
                    <option value="gl">It belongs on a general ledger account</option>
                    <option value="exp">Not a transfer — send it to the expense queues</option>
                  </select>

                  {c.mode === 'one' && (
                    <select value={c.target || ''} style={{ minWidth: 240 }}
                            onChange={e => setChoiceFor(l.leg_id, { target: e.target.value })}>
                      <option value="">Which account…</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  )}

                  {c.mode === 'gl' && (
                    <select value={c.target || ''} style={{ minWidth: 300 }}
                            onChange={e => setChoiceFor(l.leg_id, { target: e.target.value })}>
                      <option value="">Which account…</option>
                      {glAccounts.map(a => (
                        <option key={a.id} value={a.id}>{a.business} · {a.number} — {a.name}</option>
                      ))}
                    </select>
                  )}

                  {c.mode && (
                    <button className="primary"
                            disabled={!!busy || (c.mode !== 'exp' && !c.target)}
                            onClick={() => act(l.leg_id, () => {
                              if (c.mode === 'one') return rpc('tp_record_one_sided', {
                                p_txn: l.leg_id, p_other_account: c.target,
                                p_note: 'Recorded one-sided on the web console' })
                              if (c.mode === 'gl') return rpc('tp_record_to_gl', {
                                p_txn: l.leg_id, p_gl_account: c.target,
                                p_note: 'Recorded to a GL account on the web console' })
                              return rpc('tp_send_to_expenses', {
                                p_txn: l.leg_id, p_note: 'Not a transfer — sent back on the web console' })
                            })}>
                      {busy === l.leg_id ? 'Recording…' : 'Record it'}
                    </button>
                  )}

                  <button onClick={() => showAlts(l.leg_id)}>
                    {alts && alts.legId === l.leg_id ? 'Hide' : 'Look for a counterparty'}
                  </button>
                </div>

                {alts && alts.legId === l.leg_id && (
                  <Alternatives alts={alts} legId={l.leg_id} busy={busy} act={act} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Every candidate within the window, for a leg the engine could not settle. */
function Alternatives({ alts, legId, busy, act }) {
  if (!alts.rows) return <div className="loading">Looking…</div>
  if (!alts.rows.length) return <div className="muted" style={{ marginTop: 6 }}>Nothing else within the window.</div>
  return (
    <table style={{ marginTop: 6 }}>
      <thead>
        <tr>
          <th style={{ width: 90 }}>Ref</th>
          <th style={{ width: 96 }}>Date</th>
          <th style={{ width: 160 }}>Account</th>
          <th>Description</th>
          <th className="num" style={{ width: 60 }}>Gap</th>
          <th style={{ width: 150 }} />
        </tr>
      </thead>
      <tbody>
        {alts.rows.map(a => (
          <tr key={a.cpty_id}>
            <td className="muted">{a.cpty_ref}</td>
            <td>{a.cpty_date}</td>
            <td style={{ fontSize: 12 }}>{a.cpty_account}</td>
            <td>
              {a.cpty_descr}
              {a.note && <div className="muted" style={{ fontSize: 11 }}>{a.note}</div>}
            </td>
            <td className="money">{a.day_gap}d</td>
            <td>
              {a.paired
                ? <span className="pill hold">already paired</span>
                : (
                  <button className="primary" disabled={!!busy}
                          onClick={() => act(legId + a.cpty_id,
                            () => rpc('tp_accept', { p_a: legId, p_b: a.cpty_id }),
                            'Paired and posted.')}>
                    Pair with this
                  </button>
                )}
              {a.booked && <span className="pill" title="Already carries an entry.">booked</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
