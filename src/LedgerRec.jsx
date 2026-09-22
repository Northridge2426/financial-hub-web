import { useCallback, useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money, today } from './format.js'

const num = v => Number(v) || 0
const signed = v => (num(v) < 0 ? '−$' : '$') + money(Math.abs(num(v)))

/**
 * Ledger reconciliation — clearing accounts.
 *
 * A clearing account should empty out: money in, money out, nothing left. What
 * remains open is either a genuine timing difference or a pair nobody has tied
 * together. `ledger_rec_suggest` proposes groups that net to zero;
 * `reconcile_ledger_lines` closes one. Both are per-group and explicit — there
 * is no "reconcile everything" button, because a wrong grouping is tedious to
 * unpick.
 */
export default function LedgerRec() {
  const [accounts, setAccounts] = useState(null)
  const [gl, setGl] = useState('')
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState(today())
  const [window, setWindow] = useState(7)
  const [groups, setGroups] = useState(null)
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(null)

  const loadAccounts = useCallback(async () => {
    const { data, error } = await supabase.from('v_ledger_clearing_summary')
      .select('business,gl_account_id,number,account,lines,open_lines,balance,open_balance,oldest_open')
      .order('open_balance', { ascending: false })
    if (error) setErr(error.message); else setAccounts(data || [])
  }, [])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  const loadGroups = useCallback(async () => {
    if (!gl) { setGroups(null); setOpen(null); return }
    setGroups(null); setOpen(null); setErr('')
    try {
      const [sug, openLines] = await Promise.all([
        rpc('ledger_rec_suggest', { p_gl: gl, p_from: from, p_to: to, p_window: Number(window) }),
        supabase.from('v_ledger_clearing')
          .select('line_id,entry_date,memo,debit,credit,net,txn_ref,jno,origin,reconciliation_id')
          .eq('gl_account_id', gl).is('reconciliation_id', null)
          .order('entry_date')
          .then(({ data, error }) => { if (error) throw new Error(error.message); return data || [] }),
      ])
      // Fold the flat rows into their groups.
      const G = new Map()
      for (const r of sug) {
        let g = G.get(r.o_grp)
        if (!g) { g = { grp: r.o_grp, strategy: r.o_strategy, net: num(r.o_grp_net), lines: [] }; G.set(r.o_grp, g) }
        g.lines.push(r)
      }
      setGroups([...G.values()])
      setOpen(openLines)
    } catch (e) { setErr(e.message) }
  }, [gl, from, to, window])

  useEffect(() => { loadGroups() }, [loadGroups])

  async function accept(g) {
    setBusy(g.grp); setErr(''); setMsg('')
    try {
      const res = await rpc('reconcile_ledger_lines', {
        p_lines: g.lines.map(l => l.o_line_id),
        p_note: `Matched on the web console — ${g.strategy}`,
        p_on: null,
      })
      setMsg(typeof res === 'string' ? res : 'Reconciled.')
      await Promise.all([loadGroups(), loadAccounts()])
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  const picked = (accounts || []).find(a => a.gl_account_id === gl)

  return (
    <div className="page">
      <p className="hint">
        A clearing account should empty out — money in, money out, nothing left. What stays open is
        either a genuine timing difference or a pair nobody has tied together.
      </p>

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      {!accounts && <div className="loading">Reading…</div>}

      {accounts && (
        <div className="card">
          <h2>Clearing accounts</h2>
          <table>
            <thead>
              <tr>
                <th style={{ width: 62 }}>Entity</th>
                <th style={{ width: 80 }}>Number</th>
                <th>Account</th>
                <th className="num" style={{ width: 70 }}>Lines</th>
                <th className="num" style={{ width: 70 }}>Open</th>
                <th className="num" style={{ width: 120 }}>Balance</th>
                <th className="num" style={{ width: 120 }}>Still open</th>
                <th style={{ width: 110 }}>Oldest open</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.gl_account_id}
                    className={'drill' + (gl === a.gl_account_id ? ' rowsel' : '')}
                    onClick={() => setGl(gl === a.gl_account_id ? '' : a.gl_account_id)}>
                  <td><span className="pill">{a.business}</span></td>
                  <td className="muted">{a.number}</td>
                  <td>{a.account}</td>
                  <td className="money">{a.lines}</td>
                  <td className="money">
                    {num(a.open_lines)
                      ? <span className="pill hold">{a.open_lines}</span>
                      : <span className="muted">—</span>}
                  </td>
                  <td className="money">{signed(a.balance)}</td>
                  <td className={'money ' + (Math.abs(num(a.open_balance)) > 0.005 ? 'due-soon' : 'muted')}>
                    {signed(a.open_balance)}
                  </td>
                  <td>{a.oldest_open || <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ margin: '8px 0 0' }}>Click an account to work on it.</p>
        </div>
      )}

      {gl && (
        <>
          <div className="bar">
            <span><b>{picked?.number} {picked?.account}</b></span>
            <label htmlFor="lrFrom">From</label>
            <input id="lrFrom" type="date" value={from} onChange={e => setFrom(e.target.value)} />
            <label htmlFor="lrTo">To</label>
            <input id="lrTo" type="date" value={to} onChange={e => setTo(e.target.value)} />
            <label htmlFor="lrWin">Within</label>
            <input id="lrWin" type="number" min="1" max="60" value={window} style={{ width: 70 }}
                   onChange={e => setWindow(e.target.value)} />
            <span className="muted" style={{ fontSize: 12 }}>days</span>
          </div>

          {!groups && <div className="loading">Looking for matches…</div>}

          {groups && (
            <div className="card">
              <h2>Suggested matches {groups.length > 0 && <span className="muted">({groups.length})</span>}</h2>
              {groups.length === 0 ? (
                <div className="muted">Nothing nets to zero within {window} days.</div>
              ) : groups.map(g => (
                <div key={g.grp} className="note" style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <b>{g.lines.length} lines</b>
                    <span className="pill">{g.strategy}</span>
                    <span className={Math.abs(g.net) > 0.005 ? 'neg' : 'pos'}>
                      nets to {signed(g.net)}
                    </span>
                    <span style={{ flex: 1 }} />
                    <button className="primary" disabled={busy === g.grp || Math.abs(g.net) > 0.005}
                            onClick={() => accept(g)}>
                      {busy === g.grp ? 'Reconciling…' : 'Reconcile these'}
                    </button>
                  </div>
                  <table style={{ marginTop: 6 }}>
                    <tbody>
                      {g.lines.map(l => (
                        <tr key={l.o_line_id}>
                          <td style={{ width: 96 }}>{l.o_date}</td>
                          <td style={{ width: 90 }} className="muted">{l.o_ref || ''}</td>
                          <td>{l.o_memo}</td>
                          <td className="money" style={{ width: 110 }}>
                            {num(l.o_debit) ? money(l.o_debit) : ''}
                          </td>
                          <td className="money" style={{ width: 110 }}>
                            {num(l.o_credit) ? money(l.o_credit) : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {open && open.length > 0 && (
            <div className="card">
              <h2>Still open ({open.length})</h2>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 96 }}>Date</th>
                    <th style={{ width: 90 }}>Txn</th>
                    <th style={{ width: 100 }}>Entry</th>
                    <th>Memo</th>
                    <th style={{ width: 110 }}>Origin</th>
                    <th className="num" style={{ width: 110 }}>Debit</th>
                    <th className="num" style={{ width: 110 }}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map(l => (
                    <tr key={l.line_id}>
                      <td>{l.entry_date}</td>
                      <td className="muted">{l.txn_ref || ''}</td>
                      <td className="muted">{l.jno || ''}</td>
                      <td>{l.memo}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{l.origin || ''}</td>
                      <td className="money">{num(l.debit) ? money(l.debit) : ''}</td>
                      <td className="money">{num(l.credit) ? money(l.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
