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
 * `reconcile_ledger_lines` closes one.
 *
 * Every close here is undoable, and that is deliberate: matching is a judgement
 * and judgements are sometimes wrong. Auto-apply exists because doing forty
 * obvious pairs by hand is its own source of error — but it reports what it
 * did, and any group it closed can be reopened from the list below it.
 *
 * **THE OPEN LIST IS THE WORKING SURFACE, NOT A REPORT.** This page first shipped
 * able only to accept what `ledger_rec_suggest` proposed, which left no way to
 * reconcile anything the suggester could not see — and that is most of the real
 * work, because a Square payout against nine charges is not a pattern it guesses.
 * The console had it right: tick the lines, watch the net, close it at zero.
 * Restored from hub-live.html on 8 Oct 2026, with its rules intact —
 *   - two lines minimum, because one line is not a reconciliation;
 *   - Reconcile only when the net is zero, which is what clearing MEANS;
 *   - a difference is bookable only up to $250. Past that it is a missing line,
 *     and booking it would bury the thing you actually need to find.
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
  const [done, setDone] = useState(null)      // groups already reconciled
  const [glAccounts, setGlAccounts] = useState([])
  const [diffFor, setDiffFor] = useState(null)   // group awaiting a difference account
  const [diffAcct, setDiffAcct] = useState('')
  // Hand-picked lines. The console's whole working model: tick the charges and
  // the deposit that settled them, watch the net, close it when it reaches zero.
  const [sel, setSel] = useState(() => new Set())
  const [note, setNote] = useState('')
  const [manualDiff, setManualDiff] = useState(false)
  const [manualAcct, setManualAcct] = useState('')

  const loadAccounts = useCallback(async () => {
    const { data, error } = await supabase.from('v_ledger_clearing_summary')
      .select('business,gl_account_id,number,account,lines,open_lines,balance,open_balance,oldest_open')
      .order('open_balance', { ascending: false })
    if (error) setErr(error.message); else setAccounts(data || [])
  }, [])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  useEffect(() => {
    supabase.from('v_chart_of_accounts').select('business,number,name')
      .eq('usable', true).eq('postable', true).order('business').order('number')
      .then(({ data }) => setGlAccounts(data || []))
  }, [])

  const loadGroups = useCallback(async () => {
    if (!gl) { setGroups(null); setOpen(null); setDone(null); setSel(new Set()); return }
    setGroups(null); setOpen(null); setDone(null); setErr('')
    setSel(new Set()); setManualDiff(false); setManualAcct(''); setNote('')
    try {
      const [sug, openLines, closed] = await Promise.all([
        rpc('web_ledger_rec_suggest', { p_gl: gl, p_from: from, p_to: to, p_window: Number(window) }),
        supabase.from('v_ledger_clearing')
          .select('line_id,entry_date,memo,debit,credit,net,txn_ref,jno,origin,external_ref,reconciliation_id')
          .eq('gl_account_id', gl).is('reconciliation_id', null)
          .order('entry_date')
          .then(({ data, error }) => { if (error) throw new Error(error.message); return data || [] }),
        supabase.from('v_ledger_clearing')
          .select('line_id,entry_date,memo,debit,credit,net,txn_ref,jno,reconciliation_id')
          .eq('gl_account_id', gl).not('reconciliation_id', 'is', null)
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

      // Fold the closed lines into the groups they belong to, so a wrong match
      // can be found and undone rather than only regretted.
      const D = new Map()
      for (const r of closed) {
        let d = D.get(r.reconciliation_id)
        if (!d) { d = { id: r.reconciliation_id, lines: [], net: 0 }; D.set(r.reconciliation_id, d) }
        d.lines.push(r); d.net += num(r.net)
      }
      setDone([...D.values()])
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

  async function undo(d) {
    if (!globalThis.confirm(
      `Reopen this match of ${d.lines.length} lines?\n\n`
      + 'They go back on the open list. Nothing is posted and nothing is deleted.')) return
    setBusy('undo' + d.id); setErr(''); setMsg('')
    try {
      await rpc('unreconcile_ledger_group', { p_id: d.id })
      setMsg(`Reopened — ${d.lines.length} lines are back on the open list.`)
      await Promise.all([loadGroups(), loadAccounts()])
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  /** A group that does not net to zero can still be closed, by sending the
   *  remainder somewhere named. The account is asked for rather than guessed:
   *  where a difference goes is the whole decision. */
  async function closeWithDifference(g) {
    if (!diffAcct) { setErr('Pick the account the difference goes to.'); return }
    setBusy(g.grp); setErr(''); setMsg('')
    try {
      const res = await rpc('reconcile_ledger_with_difference', {
        p_ids: g.lines.map(l => l.o_line_id),
        p_gl_number: diffAcct,
        p_note: `Closed on the web console with the difference to ${diffAcct}`,
      })
      setMsg(typeof res === 'string' ? res : 'Closed, with the difference booked.')
      setDiffFor(null); setDiffAcct('')
      await Promise.all([loadGroups(), loadAccounts()])
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  /* ---- hand-picked reconciliation, the console's model ------------------ */

  const toggle = id => setSel(s => {
    const n = new Set(s)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const selNet = (open || []).filter(l => sel.has(l.line_id))
                             .reduce((a, l) => a + num(l.net), 0)
  const selRound = Math.round(selNet * 100) / 100
  const balances = sel.size >= 2 && Math.abs(selRound) < 0.005
  // A difference is bookable, not plugged — past a couple of hundred it is a
  // missing line, not a rounding or a tip, so the button stays shut.
  const diffable = sel.size >= 2 && Math.abs(selRound) >= 0.005 && Math.abs(selRound) <= 250

  async function reconcileSelected() {
    setBusy('manual'); setErr(''); setMsg('')
    try {
      const res = await rpc('reconcile_ledger_lines', {
        p_lines: [...sel], p_note: note.trim() || null, p_on: null,
      })
      setMsg(typeof res === 'string' ? res : `${sel.size} lines reconciled.`)
      setSel(new Set()); setNote('')
      await Promise.all([loadGroups(), loadAccounts()])
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  async function bookDifference() {
    if (!manualAcct) { setErr('Pick the account the difference goes to.'); return }
    setBusy('manual'); setErr(''); setMsg('')
    try {
      const res = await rpc('reconcile_ledger_with_difference', {
        p_ids: [...sel], p_gl_number: manualAcct, p_note: note.trim() || null,
      })
      setMsg(typeof res === 'string' ? res : 'Closed, with the difference booked.')
      setSel(new Set()); setNote(''); setManualDiff(false); setManualAcct('')
      await Promise.all([loadGroups(), loadAccounts()])
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  async function autoApply() {
    setBusy('auto'); setErr(''); setMsg('')
    try {
      const res = await rpc('web_ledger_rec_auto_apply', {
        p_gl: gl, p_from: from, p_to: to, p_window: Number(window),
      })
      setMsg(typeof res === 'string' ? res : 'Applied.')
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
            <span style={{ flex: 1 }} />
            <button disabled={busy === 'auto' || !(groups || []).length}
                    title="Closes every suggested group that nets to zero. It reports what it did, and anything it closed can be reopened below."
                    onClick={autoApply}>
              {busy === 'auto' ? 'Applying…'
                : `Reconcile all ${(groups || []).filter(g => Math.abs(g.net) <= 0.005).length} that net to zero`}
            </button>
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
                    {Math.abs(g.net) > 0.005 ? (
                      <button disabled={busy === g.grp}
                              onClick={() => { setDiffFor(diffFor === g.grp ? null : g.grp); setDiffAcct('') }}>
                        {diffFor === g.grp ? 'Cancel' : 'Close it with the difference…'}
                      </button>
                    ) : (
                      <button className="primary" disabled={busy === g.grp}
                              onClick={() => accept(g)}>
                        {busy === g.grp ? 'Reconciling…' : 'Reconcile these'}
                      </button>
                    )}
                  </div>

                  {diffFor === g.grp && (
                    <div className="bar" style={{ margin: '6px 0 0' }}>
                      <span style={{ fontSize: 12.5 }}>
                        Send the {signed(g.net)} difference to
                      </span>
                      <select value={diffAcct} onChange={e => setDiffAcct(e.target.value)}
                              style={{ minWidth: 300 }}>
                        <option value="">— pick an account —</option>
                        {glAccounts.map(a => (
                          <option key={a.business + a.number} value={a.number}>
                            {a.business} · {a.number} — {a.name}
                          </option>
                        ))}
                      </select>
                      <button className="primary" disabled={!diffAcct || busy === g.grp}
                              onClick={() => closeWithDifference(g)}>
                        {busy === g.grp ? 'Closing…' : 'Close it'}
                      </button>
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        Posts the remainder there and closes the group. Undoable below.
                      </span>
                    </div>
                  )}
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

          {done && done.length > 0 && (
            <div className="card">
              <h2>Already reconciled ({done.length})</h2>
              <p className="hint" style={{ margin: '0 0 8px' }}>
                Matching is a judgement, and judgements are sometimes wrong.
                Reopening puts the lines back on the open list; it posts nothing
                and deletes nothing.
              </p>
              {done.map(d => (
                <div key={d.id} className="note" style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <b>{d.lines.length} lines</b>
                    <span className={Math.abs(d.net) > 0.005 ? 'neg' : 'pos'}>
                      nets to {signed(d.net)}
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {d.lines[0].entry_date} → {d.lines[d.lines.length - 1].entry_date}
                    </span>
                    <span style={{ flex: 1 }} />
                    <button disabled={busy === 'undo' + d.id} onClick={() => undo(d)}>
                      {busy === 'undo' + d.id ? 'Reopening…' : 'Reopen this match'}
                    </button>
                  </div>
                  <table style={{ marginTop: 6 }}>
                    <tbody>
                      {d.lines.map(l => (
                        <tr key={l.line_id}>
                          <td style={{ width: 96 }}>{l.entry_date}</td>
                          <td style={{ width: 90 }} className="muted">{l.txn_ref || l.jno || ''}</td>
                          <td>{l.memo}</td>
                          <td className="money" style={{ width: 110 }}>
                            {num(l.debit) ? money(l.debit) : ''}
                          </td>
                          <td className="money" style={{ width: 110 }}>
                            {num(l.credit) ? money(l.credit) : ''}
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
              <h2>
                Still open ({open.length})
                <span className="muted" style={{ fontWeight: 400, fontSize: 13, marginLeft: 8 }}>
                  outstanding {signed(open.reduce((a, l) => a + num(l.net), 0))}
                </span>
              </h2>

              {/* The working surface. Tick the charges and the deposit that settled
                  them; the net tells you when the group is complete. */}
              <div className="bar" style={{ margin: '0 0 8px' }}>
                <span style={{ fontSize: 12.5 }}>
                  {sel.size === 0 ? 'Nothing selected' : (
                    <>
                      <b>{sel.size} selected</b>, nets to{' '}
                      <b className={balances ? 'pos' : 'due-soon'}>{signed(selRound)}</b>
                    </>
                  )}
                </span>
                <span style={{ flex: 1 }} />
                <button onClick={() => setSel(new Set(open.map(l => l.line_id)))}>Select all</button>
                <button disabled={!sel.size} onClick={() => { setSel(new Set()); setManualDiff(false) }}>
                  Clear
                </button>
                <button className="primary" disabled={!balances || busy === 'manual'}
                        title={sel.size < 2 ? 'Pick at least two lines.'
                             : !balances ? 'A group has to net to zero — that is what clearing means.'
                             : 'Close these lines against each other.'}
                        onClick={reconcileSelected}>
                  {busy === 'manual' ? 'Reconciling…' : 'Reconcile'}
                </button>
                <button disabled={!diffable || busy === 'manual'}
                        title={sel.size >= 2 && Math.abs(selRound) > 250
                          ? 'Over $250 is a missing line, not a difference — find it rather than booking it.'
                          : 'Where a settlement is a little over or under, book the remainder and close the group.'}
                        onClick={() => { setManualDiff(d => !d); setManualAcct('') }}>
                  {diffable ? `Book the ${signed(Math.abs(selRound))} difference…`
                            : 'Book the difference…'}
                </button>
              </div>

              {(sel.size > 0) && (
                <div className="bar" style={{ margin: '0 0 8px' }}>
                  <label htmlFor="lrNote" style={{ fontSize: 12.5 }}>Note</label>
                  <input id="lrNote" value={note} onChange={e => setNote(e.target.value)}
                         placeholder="e.g. Square payout of 14 March — optional"
                         style={{ flex: 1, minWidth: 240 }} />
                </div>
              )}

              {manualDiff && diffable && (
                <div className="note warn" style={{ marginBottom: 8 }}>
                  The selection is <b>{signed(Math.abs(selRound))} {selRound < 0 ? 'over' : 'short'}</b> —
                  where does the difference go?
                  <div className="bar" style={{ margin: '6px 0 0' }}>
                    <select value={manualAcct} onChange={e => setManualAcct(e.target.value)}
                            style={{ minWidth: 320 }}>
                      <option value="">— pick an account —</option>
                      {/* The console's own shortlist first, by direction: an overage is
                          usually a tip, a shortage usually cash short or misc revenue. */}
                      {(selRound < 0 ? ['2640', '4460'] : ['4460', '5630', '2640']).map(n => {
                        const a = glAccounts.find(x => x.number === n && x.business === picked?.business)
                        return a ? (
                          <option key={'s' + n} value={n}>{a.business} · {n} — {a.name}</option>
                        ) : null
                      })}
                      <option disabled>──────────</option>
                      {glAccounts.map(a => (
                        <option key={a.business + a.number} value={a.number}>
                          {a.business} · {a.number} — {a.name}
                        </option>
                      ))}
                    </select>
                    <button className="primary" disabled={!manualAcct || busy === 'manual'}
                            onClick={bookDifference}>
                      {busy === 'manual' ? 'Closing…' : 'Book it and reconcile'}
                    </button>
                  </div>
                </div>
              )}

              <table>
                <thead>
                  <tr>
                    <th style={{ width: 28 }} />
                    <th style={{ width: 96 }}>Date</th>
                    <th style={{ width: 90 }}>Txn</th>
                    <th style={{ width: 100 }}>Entry</th>
                    <th>Memo</th>
                    <th style={{ width: 100 }}
                        title="The processor's own batch reference. Lines sharing one settled together.">
                      Batch
                    </th>
                    <th className="num" style={{ width: 110 }}>Debit</th>
                    <th className="num" style={{ width: 110 }}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map(l => (
                    <tr key={l.line_id}
                        className={sel.has(l.line_id) ? 'rowsel' : ''}
                        style={{ cursor: 'pointer' }}
                        onClick={() => toggle(l.line_id)}>
                      <td onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={sel.has(l.line_id)}
                               onChange={() => toggle(l.line_id)} />
                      </td>
                      <td>{l.entry_date}</td>
                      <td className="muted">{l.txn_ref || ''}</td>
                      <td className="muted">{l.jno || ''}</td>
                      <td>{l.memo}</td>
                      <td className="muted" style={{ fontSize: 11 }} title={l.external_ref || ''}>
                        {l.external_ref ? l.external_ref.slice(0, 8) + '…' : ''}
                      </td>
                      <td className="money">{num(l.debit) ? money(l.debit) : ''}</td>
                      <td className="money">{num(l.credit) ? money(l.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint" style={{ margin: '8px 0 0' }}>
                A selection has to net to zero — the charges and the deposit that settled them.
                Anything that will not balance is a genuine gap, not a rounding problem. Where a
                <b> batch</b> reference is shown, the processor has already told us which lines
                settled together.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
