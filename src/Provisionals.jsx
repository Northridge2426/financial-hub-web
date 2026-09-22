import { useCallback, useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money } from './format.js'
import DocLink from './DocLink.jsx'

const num = v => Number(v) || 0

/**
 * Provisional entries — a receipt with no bank line yet.
 *
 * The provisional keeps the expense in the right month instead of leaving it to
 * appear whenever the card statement lands. When the real transaction turns up,
 * `adopt_provisional` moves everything onto it and the provisional disappears.
 * Adopting is a WRITE, so nothing happens without a click on a named match.
 */
export default function Provisionals() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState(null)
  const [matches, setMatches] = useState(null)
  const [matchErr, setMatchErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setErr('')
    try {
      const [pv, bal] = await Promise.all([
        supabase.from('v_provisional')
          .select('id,ref,txn_date,amount,direction,status,account,owner_business,doc_ref,vendor,lines,candidates,age_days,storage_path')
          .order('txn_date', { ascending: false }),
        supabase.from('v_balance_with_provisional')
          .select('account,kind,business,statement_to,statement_balance,movement_since,provisional_since,lines_since,provisionals,balance_on_bank_data,balance_including_provisional')
          .order('account'),
      ])
      if (pv.error) throw new Error(pv.error.message)
      if (bal.error) throw new Error(bal.error.message)
      setData({ pv: pv.data || [], bal: bal.data || [] })
    } catch (e) { setErr(e.message) }
  }, [])

  useEffect(() => { setData(null); load() }, [load])

  async function showMatches(r) {
    if (openId === r.id) { setOpenId(null); return }
    setOpenId(r.id); setMatches(null); setMatchErr('')
    try {
      setMatches(await rpc('provisional_matches', { p_prov: r.id, p_days: 12 }))
    } catch (e) { setMatchErr(e.message) }
  }

  async function adopt(provId, txnId) {
    setBusy(true); setMsg(''); setErr('')
    try {
      const res = await rpc('adopt_provisional', { p_real: txnId, p_prov: provId })
      setMsg(typeof res === 'string' ? res : 'Adopted.')
      setOpenId(null); setMatches(null)
      setData(null); await load()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  if (err && !data) return <div className="page"><div className="err">{err}</div></div>
  if (!data) return <div className="page"><div className="loading">Loading…</div></div>

  const { pv, bal } = data

  return (
    <div className="page">
      <p className="hint">
        A receipt with no bank line yet. The provisional holds the expense in the month it happened
        rather than the month the card statement arrives. When the real transaction shows up,
        adopting it moves everything across and the provisional goes away.
      </p>

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      <div className="card">
        <h2>Open provisionals</h2>
        {pv.length === 0 ? (
          <div className="muted">None open.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 90 }}>No.</th>
                <th style={{ width: 96 }}>Date</th>
                <th>Vendor</th>
                <th style={{ width: 170 }}>Account</th>
                <th className="num" style={{ width: 100 }}>Amount</th>
                <th className="num" style={{ width: 60 }}>Lines</th>
                <th className="num" style={{ width: 60 }}>Age</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {pv.map(r => [
                <tr key={r.id}>
                  <td><b>{r.ref}</b></td>
                  <td>{r.txn_date}</td>
                  <td>
                    {r.vendor}
                    {r.doc_ref && <span className="muted" style={{ marginLeft: 6 }}>{r.doc_ref}</span>}
                    {r.storage_path && <DocLink path={r.storage_path} label="doc" />}
                  </td>
                  <td>
                    {r.account}
                    {r.owner_business && <span className="pill">{r.owner_business}</span>}
                  </td>
                  <td className="money">${money(r.amount)}</td>
                  <td className="money">
                    {num(r.lines) ? r.lines : <span className="muted">none</span>}
                  </td>
                  <td className="money">{r.age_days}d</td>
                  <td>
                    {num(r.candidates) ? (
                      <button className="primary" onClick={() => showMatches(r)}>
                        {r.candidates} match{num(r.candidates) > 1 ? 'es' : ''}
                      </button>
                    ) : <span className="muted">no bank line yet</span>}
                  </td>
                </tr>,
                openId === r.id && (
                  <tr key={r.id + '-m'} className="expand">
                    <td colSpan={8}>
                      {matchErr && <div className="err">{matchErr}</div>}
                      {!matches && !matchErr && <div className="loading">Looking…</div>}
                      {matches && matches.length === 0 && (
                        <div className="muted">Nothing close enough to offer.</div>
                      )}
                      {matches && matches.length > 0 && (
                        <>
                          <div className="muted" style={{ marginBottom: 4, fontSize: 12 }}>
                            Adopting moves {r.ref} onto the bank line. Nothing else changes.
                          </div>
                          <table>
                            <thead>
                              <tr>
                                <th style={{ width: 90 }}>Ref</th>
                                <th style={{ width: 96 }}>Date</th>
                                <th>Description</th>
                                <th style={{ width: 160 }}>Account</th>
                                <th className="num" style={{ width: 100 }}>Amount</th>
                                <th className="num" style={{ width: 70 }}>Gap</th>
                                <th className="num" style={{ width: 70 }}>Score</th>
                                <th style={{ width: 100 }} />
                              </tr>
                            </thead>
                            <tbody>
                              {matches.map(m => (
                                <tr key={m.txn_id}>
                                  <td className="muted">{m.ref}</td>
                                  <td>{m.txn_date}</td>
                                  <td>{m.descr}</td>
                                  <td style={{ fontSize: 12 }}>
                                    {m.account}
                                    {m.cross_account && (
                                      <span className="pill hold" title="A different account from the provisional's.">
                                        other account
                                      </span>
                                    )}
                                  </td>
                                  <td className="money">${money(m.amount)}</td>
                                  <td className="money">{m.day_gap}d</td>
                                  <td className="money">{m.score}</td>
                                  <td>
                                    <button className="primary" disabled={busy}
                                            onClick={() => adopt(r.id, m.txn_id)}>
                                      {busy ? '…' : 'Adopt'}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}
                    </td>
                  </tr>
                ),
              ])}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>What each balance looks like with and without them</h2>
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th style={{ width: 110 }}>Statement to</th>
              <th className="num" style={{ width: 110 }}>Statement</th>
              <th className="num" style={{ width: 120 }}>Bank lines since</th>
              <th className="num" style={{ width: 120 }}>On bank data</th>
              <th className="num" style={{ width: 110 }}>Provisional</th>
              <th className="num" style={{ width: 130 }}>Including it</th>
            </tr>
          </thead>
          <tbody>
            {bal.map((r, i) => (
              <tr key={i}>
                <td>
                  {r.account}
                  {r.business && <span className="pill">{r.business}</span>}
                </td>
                <td>{r.statement_to || <span className="muted">none</span>}</td>
                <td className="money">{money(r.statement_balance)}</td>
                <td className="money">{money(r.movement_since)}</td>
                <td className="money">{money(r.balance_on_bank_data)}</td>
                <td className="money">
                  {num(r.provisional_since)
                    ? <span className="due-soon">{money(r.provisional_since)}</span>
                    : <span className="muted">—</span>}
                </td>
                <td className="money"><b>{money(r.balance_including_provisional)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          The two right-hand columns differ by exactly what is still provisional. The left one is
          what the bank can prove; the right one is what you actually owe.
        </p>
      </div>
    </div>
  )
}
