import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money } from './format.js'
import TxnEditor from './TxnEditor.jsx'

const num = v => Number(v) || 0
const signed = v => (num(v) < 0 ? '−$' : '$') + money(Math.abs(num(v)))

/**
 * Bank reconciliation — statement lines on one side, ledger lines on the other,
 * matched until nothing is left.
 *
 * Every write here is explicit. `bank_rec_complete` defaults to preview, so the
 * button that runs it shows you what it WOULD do; finalising is a separate,
 * deliberate second click. Nothing reconciles itself while you are reading.
 */
export default function BankRecon() {
  const [statements, setStatements] = useState(null)
  const [sid, setSid] = useState('')
  const [bank, setBank] = useState(null)
  const [glLines, setGlLines] = useState(null)
  const [pickBank, setPickBank] = useState([])
  const [pickGl, setPickGl] = useState([])
  const [preview, setPreview] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [hideMatched, setHideMatched] = useState(true)
  const [acct, setAcct] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [coding, setCoding] = useState(null)      // txn_id open for editing
  const [codingRow, setCodingRow] = useState(null)

  const loadStatements = useCallback(async () => {
    const { data, error } = await supabase.from('v_bank_rec_statements')
      .select('statement_id,account,kind,business,period_start,period_end,opening_balance,closing_balance,finalised,bank_items,bank_open,gl_items,gl_open')
      .order('finalised').order('period_end', { ascending: false })
    if (error) setErr(error.message); else setStatements(data || [])
  }, [])

  useEffect(() => { loadStatements() }, [loadStatements])

  const loadSides = useCallback(async () => {
    if (!sid) { setBank(null); setGlLines(null); return }
    setBank(null); setGlLines(null); setPreview(null)
    setPickBank([]); setPickGl([]); setErr('')
    try {
      const [b, g] = await Promise.all([
        rpc('bank_rec_bank', { p_statement: sid }),
        rpc('bank_rec_gl', { p_statement: sid }),
      ])
      setBank(b); setGlLines(g)
    } catch (e) { setErr(e.message) }
  }, [sid])

  useEffect(() => { loadSides() }, [loadSides])

  const toggle = (setFn, id) =>
    setFn(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  async function act(name, fn) {
    setBusy(name); setErr(''); setMsg('')
    try {
      const res = await fn()
      setMsg(typeof res === 'string' ? res : 'Done.')
      await Promise.all([loadSides(), loadStatements()])
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  /**
   * Code a bank line without leaving the reconciliation.
   *
   * The alternative — a link into the review queues — loses the period you are
   * halfway through, and the transaction may not be in that queue's current
   * filter anyway. `web_txn_row` returns the row in exactly the shape the queue
   * editor expects, so the same editor opens here.
   */
  async function openCoding(txnId) {
    if (coding === txnId) { setCoding(null); setCodingRow(null); return }
    setCoding(txnId); setCodingRow(null); setErr('')
    try {
      const r = await rpc('web_txn_row', { p_txn: txnId })
      if (!r.length) { setErr('That line has no transaction behind it.'); setCoding(null); return }
      setCodingRow(r[0])
    } catch (e) { setErr(e.message); setCoding(null) }
  }

  async function runPreview() {
    setBusy('preview'); setErr(''); setMsg('')
    try {
      setPreview(await rpc('bank_rec_complete', { p_statement: sid, p_preview: true }))
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  // One row per account, newest work first, with how much is left on it.
  const accountList = useMemo(() => {
    const m = new Map()
    for (const s of statements || []) {
      let a = m.get(s.account)
      if (!a) { a = { account: s.account, kind: s.kind, business: s.business, openPeriods: 0 }; m.set(s.account, a) }
      if (!s.finalised) a.openPeriods += 1
    }
    return [...m.values()].sort((x, y) => (y.openPeriods - x.openPeriods) || x.account.localeCompare(y.account))
  }, [statements])

  // Oldest first. A period is reconciled against the one before it — its
  // opening balance is the previous closing — so working newest-first means
  // finalising a period whose predecessor is still open, and any difference
  // found later has nowhere to go.
  const forAccount = useMemo(
    () => (statements || []).filter(s => s.account === acct)
                            .sort((a, z) => (a.period_end || '').localeCompare(z.period_end || '')),
    [statements, acct])

  const doneCount = forAccount.filter(s => s.finalised).length
  const periods = forAccount.filter(s => showDone || !s.finalised)

  const st = (statements || []).find(s => s.statement_id === sid)
  const bankShown = (bank || []).filter(r => !hideMatched || !r.matched)
  const glShown = (glLines || []).filter(r => !hideMatched || !r.matched)
  const selTotalBank = (bank || []).filter(r => pickBank.includes(r.txn_id))
    .reduce((a, r) => a + num(r.amount), 0)
  const selTotalGl = (glLines || []).filter(r => pickGl.includes(r.line_id))
    .reduce((a, r) => a + num(r.amount), 0)
  // `bank_rec_match` requires only that the two sides AGREE, and refuses an
  // empty selection on both. With one side empty that side sums to zero, so a
  // set on the other side that nets to zero is a valid match — a charge and its
  // reversal on the statement with nothing in the ledger, or the reverse. That
  // was always allowed in SQL; requiring both sides here was a UI invention.
  const selBalanced = (pickBank.length > 0 || pickGl.length > 0) &&
    Math.abs(selTotalBank - selTotalGl) < 0.005

  return (
    <div className="page">
      <p className="hint">
        Statement lines on one side, ledger lines on the other. Tick what belongs together and
        match it. Nothing here runs on its own — completing is previewed first and finalised
        separately.
      </p>

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      {!statements && <div className="loading">Reading…</div>}

      {/* Account first, then period. One list of every statement across every
          account ran to hundreds of entries in no order anyone could scan, and
          finalised periods — the ones you are least likely to want — sat in the
          middle of it. */}
      {statements && (
        <div className="bar">
          <label htmlFor="brAcct">Account</label>
          <select id="brAcct" value={acct} style={{ minWidth: 260 }}
                  onChange={e => { setAcct(e.target.value); setSid('') }}>
            <option value="">Pick an account…</option>
            {accountList.map(a => (
              <option key={a.account} value={a.account}>
                {a.account}
                {a.openPeriods ? ` · ${a.openPeriods} to do` : ' · all done'}
              </option>
            ))}
          </select>

          {acct && (
            <>
              <label htmlFor="brPeriod">Period</label>
              <select id="brPeriod" value={sid} style={{ minWidth: 300 }}
                      onChange={e => setSid(e.target.value)}>
                <option value="">Pick a period…</option>
                {periods.map(s => (
                  <option key={s.statement_id} value={s.statement_id}>
                    {s.finalised ? '✓ ' : ''}{s.period_start} → {s.period_end}
                    {num(s.bank_open) || num(s.gl_open)
                      ? ` · ${s.bank_open} bank / ${s.gl_open} ledger open` : ' · clear'}
                  </option>
                ))}
              </select>
              {doneCount > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={showDone} style={{ width: 'auto' }}
                         onChange={e => {
                           setShowDone(e.target.checked)
                           // Unticking while a finalised period is open would leave
                           // the pane showing a period the selector no longer offers.
                           if (!e.target.checked && st && st.finalised) setSid('')
                         }} />
                  Show the {doneCount} completed
                </label>
              )}
            </>
          )}

          {sid && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input type="checkbox" checked={hideMatched} style={{ width: 'auto' }}
                     onChange={e => setHideMatched(e.target.checked)} />
              Hide what's already matched
            </label>
          )}
        </div>
      )}

      {st && (
        <div className="grid" style={{ marginBottom: 14 }}>
          <div className="stat"><div className="n">{signed(st.opening_balance)}</div><div className="l">opening</div></div>
          <div className="stat"><div className="n">{signed(st.closing_balance)}</div><div className="l">closing</div></div>
          <div className="stat">
            <div className={'n ' + (num(st.bank_open) ? 'warn' : 'pos')}>{st.bank_open}</div>
            <div className="l">bank lines open</div>
          </div>
          <div className="stat">
            <div className={'n ' + (num(st.gl_open) ? 'warn' : 'pos')}>{st.gl_open}</div>
            <div className="l">ledger lines open</div>
          </div>
        </div>
      )}

      {sid && (
        <div className="bar">
          <button disabled={!!busy}
                  onClick={() => act('auto', () => rpc('bank_rec_auto', { p_statement: sid }))}>
            {busy === 'auto' ? 'Matching…' : 'Match the obvious ones'}
          </button>
          <button className="primary" disabled={!selBalanced || !!busy}
                  onClick={() => act('match', () => rpc('bank_rec_match', {
                    p_statement: sid, p_gl: pickGl, p_txn: pickBank,
                    p_note: 'Matched on the web console',
                  }))}>
            {busy === 'match' ? 'Matching…' : `Match ${pickGl.length} ledger ↔ ${pickBank.length} bank`}
          </button>
          {(pickBank.length > 0 || pickGl.length > 0) && (
            <span className={'muted ' + (selBalanced ? 'pos' : '')} style={{ fontSize: 12 }}>
              ledger {signed(selTotalGl)} vs bank {signed(selTotalBank)}
              {!selBalanced && (pickBank.length === 0 || pickGl.length === 0
                ? ' — one side only, so it has to net to zero'
                : ' — not equal')}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {st && st.finalised ? (
            <>
              <span className="pill soft">finalised</span>
              {/* The console can undo this and the web app could not, which is
                  the asymmetry worth closing: it let you lock a period here and
                  then need the artifact to unlock it. */}
              <button disabled={!!busy}
                      title="Unlocks the period so lines can be matched again. Posts nothing and unmatches nothing."
                      onClick={() => {
                        if (!window.confirm(
                          `Reopen ${st.account} ${st.period_start} → ${st.period_end}?\n\n`
                          + 'The period stops being locked. Existing matches stay as they are.')) return
                        act('reopen', () => rpc('bank_rec_reopen', { p_statement: sid }))
                      }}>
                {busy === 'reopen' ? 'Reopening…' : 'Reopen this period'}
              </button>
            </>
          ) : (
            <button disabled={!!busy} onClick={runPreview}>
              {busy === 'preview' ? 'Checking…' : 'Preview completing it'}
            </button>
          )}
        </div>
      )}

      {preview && (
        <div className="note">
          <b>What completing would do</b>
          <table style={{ marginTop: 6 }}>
            <tbody>
              {preview.length === 0 && (
                <tr><td className="muted">Nothing left to do — it already ties.</td></tr>
              )}
              {preview.map((p, i) => (
                <tr key={i}>
                  <td style={{ width: 160 }}><b>{p.action}</b></td>
                  <td>{p.detail}</td>
                  <td className="money" style={{ width: 120 }}>
                    {num(p.amount) ? signed(p.amount) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="bar" style={{ margin: '8px 0 0' }}>
            <button className="primary" disabled={!!busy}
                    onClick={() => act('finalise', () =>
                      rpc('bank_rec_finalise', { p_statement: sid, p_note: 'Finalised on the web console' }))}>
              {busy === 'finalise' ? 'Finalising…' : 'Finalise this period'}
            </button>
            <button onClick={() => setPreview(null)}>Cancel</button>
            <span className="muted" style={{ fontSize: 12 }}>
              Finalising locks the period. It can be reopened, but do it deliberately.
            </span>
          </div>
        </div>
      )}

      {sid && (!bank || !glLines) && <div className="loading">Reading both sides…</div>}

      {bank && glLines && (
        <div className="twocol">
          <div className="card">
            <h2>From the ledger ({glShown.length})</h2>
            <table>
              <tbody>
                {glShown.length === 0 && (
                  <tr><td className="muted">Nothing open.</td></tr>
                )}
                {glShown.map(r => (
                  <tr key={r.line_id} className={r.matched ? 'muted' : ''}>
                    <td style={{ width: 28 }}>
                      <input type="checkbox" disabled={r.matched}
                             checked={pickGl.includes(r.line_id)}
                             onChange={() => toggle(setPickGl, r.line_id)} />
                    </td>
                    <td style={{ width: 92 }}>{r.entry_date}</td>
                    <td style={{ width: 84 }} className="muted">{r.ref || ''}</td>
                    <td>
                      {r.descr}
                      {r.carried_in && <span className="pill hold">carried in</span>}
                    </td>
                    <td className="money" style={{ width: 110 }}>{signed(r.amount)}</td>
                    <td style={{ width: 62 }}>
                      {r.matched && r.match_id && (
                        <button disabled={!!busy} style={{ padding: '1px 8px', fontSize: 11 }}
                                title="Breaks this match and puts both sides back on the open lists. Posts nothing."
                                onClick={() => act('unmatch', () =>
                                  rpc('bank_rec_unmatch', { p_match: r.match_id }))}>
                          unmatch
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>From the statement ({bankShown.length})</h2>
            <table>
              <tbody>
                {bankShown.length === 0 && (
                  <tr><td className="muted">Nothing open.</td></tr>
                )}
                {bankShown.map(r => [
                  <tr key={r.txn_id} className={r.matched ? 'muted' : ''}>
                    <td style={{ width: 28 }}>
                      <input type="checkbox" disabled={r.matched}
                             checked={pickBank.includes(r.txn_id)}
                             onChange={() => toggle(setPickBank, r.txn_id)} />
                    </td>
                    <td style={{ width: 92 }}>{r.txn_date}</td>
                    <td style={{ width: 84 }} className="muted">{r.ref || ''}</td>
                    <td>
                      {r.descr}
                      {r.carried_in && <span className="pill hold" title="From an earlier period.">carried in</span>}
                      {!r.has_entry && <span className="pill hold">no entry</span>}
                    </td>
                    <td className="money" style={{ width: 110 }}>{signed(r.amount)}</td>
                    <td style={{ width: 118 }}>
                      <button style={{ padding: '1px 8px', fontSize: 11 }}
                              title={r.has_entry
                                ? 'Open the entry behind this line and correct it, without leaving the reconciliation.'
                                : 'Nothing is posted against this line yet. Code it here.'}
                              onClick={() => openCoding(r.txn_id)}>
                        {coding === r.txn_id ? 'close' : r.has_entry ? 'entry' : 'code'}
                      </button>{' '}
                      {r.matched && r.match_id && (
                        <button disabled={!!busy} style={{ padding: '1px 8px', fontSize: 11 }}
                                title="Breaks this match and puts both sides back on the open lists. Posts nothing."
                                onClick={() => act('unmatch', () =>
                                  rpc('bank_rec_unmatch', { p_match: r.match_id }))}>
                          unmatch
                        </button>
                      )}
                    </td>
                  </tr>,
                  coding === r.txn_id && (
                    <tr key={r.txn_id + '-code'} className="expand">
                      <td colSpan={6}>
                        {!codingRow && <div className="loading">Reading…</div>}
                        {codingRow && (
                          <TxnEditor txn={codingRow} kind="plain"
                                     onDone={() => { loadSides(); loadStatements() }} />
                        )}
                      </td>
                    </tr>
                  ),
                ])}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
