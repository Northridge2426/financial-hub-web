import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'
import { useEntities } from './useEntities.js'

const num = v => Number(v) || 0

/**
 * Payment prioritisation — what each balance costs, dearest first.
 *
 * Reads the same `financial_overview()` as the Overview page, then filters to
 * liabilities still owing and sorts by effective rate. The sort is on
 * `effective_rate`, not `rate`: a promotional rate counts only while it is
 * running, so a balance reverting next month is not cheap money — the block at
 * the bottom is there to say so before you act on the order above it.
 */
export default function PaymentPriority() {
  const [biz, setBiz] = useState('')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const entities = useEntities()

  useEffect(() => {
    setRows(null); setErr('')
    rpc('financial_overview', { p_as_of: null, p_include_hidden: false })
      .then(all => setRows(
        all
          .filter(r => r.kind === 'liability' && num(r.owed) > 0.005)
          .filter(r => !biz || r.business === biz)
          .sort((a, b) =>
            (num(b.effective_rate) - num(a.effective_rate)) || (num(b.owed) - num(a.owed)))
      ))
      .catch(e => setErr(e.message))
  }, [biz])

  const pct = r => num(r.effective_rate) * 100

  return (
    <div className="page">
      <p className="hint">
        What each balance costs, dearest first. A promotional rate counts only while it is
        running — a balance reverting next month is not cheap money.
      </p>

      <div className="bar">
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">All entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
      </div>

      {err && <div className="err">{err}</div>}
      {!rows && !err && <div className="loading">Reading…</div>}
      {rows && rows.length === 0 && <div className="card"><div className="muted">Nothing owing.</div></div>}

      {rows && rows.length > 0 && (() => {
        const totOwed = rows.reduce((a, r) => a + num(r.owed), 0)
        const annual = rows.reduce((a, r) => a + num(r.owed) * pct(r) / 100, 0)
        const reverting = rows
          .filter(r => r.promo_days_left != null && num(r.promo_days_left) >= 0)
          .sort((a, b) => num(a.promo_days_left) - num(b.promo_days_left))
        const top = rows[0]

        return (
          <>
            <div className="grid" style={{ marginBottom: 14 }}>
              <div className="stat"><div className="n">${money(totOwed)}</div><div className="l">owing</div></div>
              <div className="stat">
                <div className="n neg">${money(annual)}</div>
                <div className="l">interest a year at today's rates</div>
              </div>
              <div className="stat">
                <div className="n">{(100 * annual / (totOwed || 1)).toFixed(2)}%</div>
                <div className="l">blended rate</div>
              </div>
              <div className="stat">
                <div className={'n ' + (reverting.length ? 'warn' : '')}>{reverting.length}</div>
                <div className="l">on a promotion</div>
              </div>
            </div>

            <div className="note">
              <b>Pay {top.name} first.</b> At {pct(top).toFixed(2)}% every $1,000 put against it
              saves <b>${money(pct(top) * 10)}</b> a year — more than against anything else on
              this list.
            </div>

            <div className="card">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 26 }} />
                    <th>Account</th>
                    <th style={{ width: 118 }}>Class</th>
                    <th className="num" style={{ width: 76 }}>Rate now</th>
                    <th style={{ width: 140 }}>Promotion</th>
                    <th className="num" style={{ width: 112 }}>Owing</th>
                    <th className="num" style={{ width: 60 }}>Used</th>
                    <th className="num" style={{ width: 110 }}>Cost a year</th>
                    <th style={{ width: 150 }}>Paid from</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const rev = r.promo_days_left != null && num(r.promo_days_left) >= 0
                    return (
                      <tr key={r.position_id}>
                        <td className="muted">{i + 1}</td>
                        <td>
                          <b>{r.name}</b> <span className="pill">{r.business}</span>
                          <NoteField id={r.position_id} value={r.notes}
                                     onSaved={v => setRows(rs => rs.map(x =>
                                       x.position_id === r.position_id ? { ...x, notes: v } : x))} />
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>{r.class_label}</td>
                        <td className="money"><b>{pct(r).toFixed(2)}%</b></td>
                        <td style={{ fontSize: 11.5 }}>
                          {rev && (
                            <>
                              <span className="pos">until {r.promo_ends}</span>
                              <div className="muted">
                                then {(num(r.rate) * 100).toFixed(2)}% · {r.promo_days_left}d
                              </div>
                            </>
                          )}
                        </td>
                        <td className="money">${money(r.owed)}</td>
                        <td className="money">
                          {r.usage_pct != null ? Number(r.usage_pct).toFixed(0) + '%' : ''}
                        </td>
                        <td className="money">${money(num(r.owed) * pct(r) / 100)}</td>
                        <td style={{ fontSize: 12 }}>{r.funding || <span className="muted">—</span>}</td>
                      </tr>
                    )
                  })}
                  <tr className="total">
                    <td colSpan={5}>Total</td>
                    <td className="money">${money(totOwed)}</td>
                    <td />
                    <td className="money">${money(annual)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

            {reverting.length > 0 && (
              <div className="note warn">
                <b>This order changes when the promotions end.</b>{' '}
                {reverting.map((r, i) => (
                  <span key={r.position_id}>
                    {i > 0 && '; '}
                    {r.name} — ${money(r.owed)} goes from {pct(r).toFixed(2)}% to{' '}
                    <b>{(num(r.rate) * 100).toFixed(2)}%</b> on {r.promo_ends}, adding{' '}
                    <b>${money(num(r.owed) * (num(r.rate) * 100 - pct(r)) / 100)}</b> a year
                  </span>
                ))}.
                <div className="fine">
                  Paying those down <b>before</b> the date is worth more than the rate today suggests.
                </div>
              </div>
            )}

            <p className="hint">
              Cost a year is the balance at today's effective rate, not a forecast — it ignores
              repayments, new spending and compounding.
            </p>
          </>
        )
      })()}
    </div>
  )
}

/**
 * The position's note, edited in place — the same note the Overview edit form
 * shows under the name. Saved when you leave the box or press Enter; Esc puts
 * it back. `save_position` touches only the keys it is sent, so sending just
 * `id` and `notes` leaves the rate, limit and everything else alone; an empty
 * box clears the note.
 */
function NoteField({ id, value, onSaved }) {
  const [text, setText] = useState(value || '')
  const [state, setState] = useState('')   // '', 'saving', 'saved', or an error

  useEffect(() => { setText(value || '') }, [value])

  async function save() {
    const t = (text || '').trim()
    if (t === (value || '').trim()) return
    setState('saving')
    try {
      await rpc('save_position', { p: { id, notes: t } })
      onSaved(t || null)
      setState('saved')
      setTimeout(() => setState(s => (s === 'saved' ? '' : s)), 1500)
    } catch (e) { setState(e.message) }
  }

  const bad = state && !['saving', 'saved'].includes(state)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
      <input value={text} placeholder="add a note…" title={bad ? state : text}
             style={{ width: '100%', fontSize: 11.5, padding: '2px 6px',
                      borderColor: bad ? '#fca5a5' : undefined }}
             onChange={e => { setText(e.target.value); if (bad) setState('') }}
             onBlur={save}
             onKeyDown={e => {
               if (e.key === 'Enter') e.currentTarget.blur()
               if (e.key === 'Escape') { setText(value || ''); setState('') }
             }} />
      {state === 'saving' && <span className="muted" style={{ fontSize: 11 }}>…</span>}
      {state === 'saved' && <span className="muted" style={{ fontSize: 11, color: '#047857' }}>✓</span>}
      {bad && <span className="muted" style={{ fontSize: 11, color: '#b91c1c' }} title={state}>!</span>}
    </div>
  )
}
