import { useCallback, useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money, today } from './format.js'

const num = v => Number(v) || 0

/**
 * Every position, in one place.
 *
 * A position is LINKED or it is not. A linked one takes its balance from its
 * own statements and transactions, and is not editable here — typing over it
 * would put a number on the screen that the ledger disagrees with. An unlinked
 * one (a loan nobody exports, a vehicle) has no other source, so its balance is
 * a dated snapshot somebody entered, and entering one is what this does.
 *
 * `save_position_balances` enforces that distinction itself: hand it a linked
 * position and it returns "skipped" with the reason rather than writing.
 */
export default function Overview() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [asOf, setAsOf] = useState(today())
  const [draft, setDraft] = useState({})          // position_id -> typed balance

  const load = useCallback(() => {
    rpc('financial_overview').then(setRows).catch(e => setErr(e.message))
  }, [])

  useEffect(() => { load() }, [load])

  async function saveBalances() {
    const changed = Object.entries(draft)
      .filter(([, v]) => String(v).trim() !== '')
      .map(([position_id, v]) => ({ position_id, balance: num(v) }))
    if (!changed.length) { setEditing(false); return }
    setBusy(true); setErr(''); setMsg('')
    try {
      const res = await rpc('save_position_balances', { p_as_of: asOf, p_rows: changed })
      const saved = (res || []).filter(r => r.action === 'saved').length
      const skipped = (res || []).filter(r => r.action !== 'saved')
      setMsg(`${saved} balance${saved === 1 ? '' : 's'} recorded as at ${asOf}.`
             + (skipped.length ? ` ${skipped.length} left alone: ${skipped[0].action}.` : ''))
      setDraft({}); setEditing(false)
      load()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  if (err && !rows) return <div className="page"><div className="err">{err}</div></div>
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

  const unlinked = live.filter(r => !r.linked).length

  return (
    <div className="page">
      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      {unlinked > 0 && (
        <div className="bar">
          <span className="muted" style={{ fontSize: 12 }}>
            {unlinked} position{unlinked === 1 ? ' has' : 's have'} no statements behind
            {unlinked === 1 ? ' it' : ' them'} — {unlinked === 1 ? 'its' : 'their'} balance is
            whatever was last entered by hand.
          </span>
          <span style={{ flex: 1 }} />
          {editing && (
            <>
              <label htmlFor="ovAsOf">As at</label>
              <input id="ovAsOf" type="date" value={asOf} style={{ width: 150 }}
                     onChange={e => setAsOf(e.target.value)} />
              <button className="primary" disabled={busy} onClick={saveBalances}>
                {busy ? 'Saving…' : 'Save the balances'}
              </button>
            </>
          )}
          <button onClick={() => { setEditing(e => !e); setDraft({}) }}>
            {editing ? 'Cancel' : 'Enter balances'}
          </button>
        </div>
      )}

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
                      {editing && !r.linked ? (
                        <input type="number" step="0.01" className="num" style={{ width: 120 }}
                               value={draft[r.position_id] ?? ''}
                               placeholder={money(r.balance)}
                               onChange={e => setDraft(d => ({ ...d, [r.position_id]: e.target.value }))} />
                      ) : <>${money(r.owed)}</>}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {r.basis || '—'}
                      {!r.linked && (
                        <span className="muted" title="No statements or transactions behind it — the balance is a dated snapshot somebody entered.">
                          {' '}· entered by hand
                        </span>
                      )}
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
