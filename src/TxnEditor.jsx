import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money } from './format.js'
import { useEntities } from './useEntities.js'

const num = v => Number(v) || 0
const blank = () => ({ business: '', account: '', debit: '', credit: '', basis: '' })

/**
 * Coding one transaction.
 *
 * The shape follows the console deliberately:
 *   1. pick an allocation profile → `preview_allocation` builds the whole entry
 *   2. the proposal is SHOWN, not applied — it crosses three ledgers and there
 *      is no reason to take that on trust
 *   3. Apply copies it into an editable draft
 *   4. `set_journal_override` saves the draft
 *
 * The expense account is never guessed. `suggest_expense_accounts` says what
 * each ledger has used for this merchant before and that is offered per
 * business — the charts do not share numbering, so mirroring one number across
 * entities was never safe.
 *
 * Balance is checked PER BUSINESS. An entry that only balances in total would
 * quietly move money between entities.
 */
export default function TxnEditor({ txn, onDone }) {
  const [journal, setJournal] = useState(null)
  const [suggestion, setSuggestion] = useState([])
  const [profiles, setProfiles] = useState([])
  const [accounts, setAccounts] = useState([])
  const [profile, setProfile] = useState('')
  const [preview, setPreview] = useState(null)
  const [lines, setLines] = useState(null)      // null = not editing yet
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [notes, setNotes] = useState([])
  const [noteText, setNoteText] = useState('')
  const entities = useEntities()

  const load = useCallback(async () => {
    setErr(''); setJournal(null)
    try {
      const [j, s, n] = await Promise.all([
        rpc('journal_for', { p_txn: txn.id }).catch(() => []),
        rpc('suggest_journal', { p_txn: txn.id }).catch(() => []),
        supabase.from('transaction_notes')
          .select('id,note,status,reply,created_at,answered_at')
          .eq('transaction_id', txn.id).order('created_at', { ascending: false })
          .then(({ data }) => data || []),
      ])
      setJournal(j); setSuggestion(s); setNotes(n)
    } catch (e) { setErr(e.message) }
  }, [txn.id])

  /** Leaving a note is how the morning task gets told what to do. Without this
   *  the web app would look complete while quietly starving that task — it
   *  would report "No notes this morning" for ever and read as success. */
  async function addNote() {
    if (!noteText.trim()) return
    setBusy('note'); setErr('')
    try {
      await rpc('add_transaction_note', { p_txn: txn.id, p_note: noteText.trim() })
      setNoteText(''); setMsg('Note left — the morning task will pick it up.')
      await load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  useEffect(() => { load() }, [load])

  useEffect(() => {
    supabase.from('allocation_profiles').select('code,name,detail').order('name')
      .then(({ data }) => setProfiles(data || []))
    supabase.from('v_chart_of_accounts').select('business,number,name')
      .eq('usable', true).eq('postable', true).order('business').order('number')
      .then(({ data }) => setAccounts(data || []))
  }, [])

  async function pickProfile(code) {
    setProfile(code); setPreview(null); setErr('')
    if (!code) return
    setBusy('preview')
    try {
      const gst = num(txn.gst_amount) || null
      const [p, sug] = await Promise.all([
        rpc('preview_allocation', { p_txn: txn.id, p_profile: code, p_gl_number: null, p_gst: gst }),
        rpc('suggest_expense_accounts', { p_txn: txn.id, p_profile: code }).catch(() => []),
      ])
      // Overlay what each ledger has used before onto the expense lines only.
      const byBiz = Object.fromEntries((sug || []).map(s => [s.business, s]))
      setPreview((p || []).map(l => {
        const s = byBiz[l.business]
        return (l.line_kind === 'expense' && s && s.gl_number)
          ? { ...l, gl_number: s.gl_number, gl_name: s.gl_name, why: s.basis }
          : l
      }))
    } catch (e) { setErr(e.message); setProfile('') }
    setBusy('')
  }

  const applyPreview = () => {
    setLines((preview || []).map(l => ({
      business: l.business || '',
      account: l.gl_number || '',
      debit: num(l.debit) || '',
      credit: num(l.credit) || '',
      basis: l.memo || '',
    })))
    setPreview(null); setProfile('')
    setMsg('Applied to the draft. Check any account marked “not in this chart”.')
  }

  const setLine = (i, k, v) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l))

  const perBiz = useMemo(() => {
    const m = {}
    for (const l of lines || []) {
      if (!l.business) continue
      const b = m[l.business] || (m[l.business] = { d: 0, c: 0 })
      b.d += num(l.debit); b.c += num(l.credit)
    }
    return m
  }, [lines])

  const offBy = Object.entries(perBiz)
    .map(([b, v]) => ({ business: b, diff: Math.round((v.d - v.c) * 100) / 100 }))
    .filter(x => x.diff !== 0)

  const filled = (lines || []).filter(l => l.business && l.account && (num(l.debit) || num(l.credit)))
  const canSave = filled.length >= 2 && offBy.length === 0

  async function save() {
    setBusy('save'); setErr(''); setMsg('')
    try {
      const payload = filled.map(l => ({
        business: l.business,
        account: l.account,
        debit: num(l.debit) || 0,
        credit: num(l.credit) || 0,
        basis: l.basis || null,
      }))
      const saved = await rpc('set_journal_override', { p_txn: txn.id, p_lines: payload })
      setMsg(`Saved — ${saved.length} line${saved.length === 1 ? '' : 's'}.`)
      setLines(null)
      await load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  async function markReviewed() {
    setBusy('review'); setErr(''); setMsg('')
    try {
      const out = await rpc('bulk_mark_reviewed', { p_ids: [txn.id], p_note: 'Reviewed on the web console' })
      setMsg((out && out[0] && out[0].outcome) || 'Marked reviewed.')
      if (onDone) onDone()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  const accountsFor = biz => accounts.filter(a => a.business === biz)

  return (
    <div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        {txn.ref} · {txn.txn_date} · {txn.account} · {txn.description_raw}
        {num(txn.gst_amount) > 0 && <> · GST ${money(txn.gst_amount)}</>}
      </div>

      {txn.journal_hold && txn.journal_hold_reason && (
        <div className="note warn" style={{ marginBottom: 8 }}>{txn.journal_hold_reason}</div>
      )}
      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      {/* ---- what is posted now ---- */}
      {!journal && <div className="loading">Reading…</div>}
      {journal && journal.length > 0 && (
        <>
          <b style={{ fontSize: 12.5 }}>Posted</b>
          <table style={{ marginTop: 3, marginBottom: 8 }}>
            <tbody>
              {journal.map((l, i) => (
                <tr key={i}>
                  <td style={{ width: 60 }}><span className="pill">{l.business}</span></td>
                  <td style={{ width: 90 }} className="muted">{l.gl_number}</td>
                  <td>{l.gl_name}{l.note && <div className="muted" style={{ fontSize: 11 }}>{l.note}</div>}</td>
                  <td className="money" style={{ width: 100 }}>{num(l.debit) ? money(l.debit) : ''}</td>
                  <td className="money" style={{ width: 100 }}>{num(l.credit) ? money(l.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {journal && journal.length === 0 && (
        <div className="muted" style={{ marginBottom: 8 }}>Nothing posted against this yet.</div>
      )}

      {/* ---- the ledger's own history ---- */}
      {suggestion.length > 0 && !lines && (
        <details style={{ marginBottom: 8 }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>
            What the ledger has done with this vendor before ({suggestion.length})
          </summary>
          <table style={{ marginTop: 3 }}>
            <tbody>
              {suggestion.map((s, i) => (
                <tr key={i}>
                  <td style={{ width: 60 }}><span className="pill">{s.business}</span></td>
                  <td style={{ width: 90 }} className="muted">{s.account}</td>
                  <td>{s.account_name}
                    {s.basis && <div className="muted" style={{ fontSize: 11 }}>{s.basis}</div>}</td>
                  <td className="money" style={{ width: 100 }}>{num(s.debit) ? money(s.debit) : ''}</td>
                  <td className="money" style={{ width: 100 }}>{num(s.credit) ? money(s.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {/* ---- notes: what the morning task reads ---- */}
      <div className="note" style={{ marginBottom: 8 }}>
        {notes.length > 0 && (
          <table style={{ marginBottom: 6 }}>
            <tbody>
              {notes.map(n => (
                <tr key={n.id}>
                  <td style={{ width: 92 }} className="muted">
                    {String(n.created_at || '').slice(0, 10)}
                  </td>
                  <td>
                    {n.note}
                    {n.reply && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        ↳ {n.reply}
                      </div>
                    )}
                  </td>
                  <td style={{ width: 90 }}>
                    <span className={'pill ' + (n.status === 'open' ? 'hold' : 'soft')}>
                      {n.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="bar" style={{ margin: 0 }}>
          <input placeholder="Leave a note — the morning task works these" value={noteText}
                 onChange={e => setNoteText(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') addNote() }}
                 style={{ flex: 1, minWidth: 240 }} />
          <button disabled={!noteText.trim() || busy === 'note'} onClick={addNote}>
            {busy === 'note' ? 'Saving…' : 'Leave a note'}
          </button>
        </div>
      </div>

      {/* ---- allocation profile ---- */}
      {!lines && (
        <div className="bar" style={{ margin: '0 0 8px' }}>
          <label>Allocation</label>
          <select value={profile} onChange={e => pickProfile(e.target.value)} style={{ minWidth: 300 }}>
            <option value="">— pick a profile to see the entry —</option>
            {profiles.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
          {busy === 'preview' && <span className="muted">Building it…</span>}
          <span style={{ flex: 1 }} />
          <button onClick={() => setLines([blank(), blank()])}>Write it by hand</button>
          <button disabled={busy === 'review'} onClick={markReviewed}>
            {busy === 'review' ? 'Marking…' : 'Mark reviewed'}
          </button>
        </div>
      )}

      {/* ---- the proposal, shown before it is applied ---- */}
      {preview && (
        <div className="note">
          <b>This is what would be posted</b>
          <table style={{ marginTop: 6 }}>
            <tbody>
              {preview.map((l, i) => (
                <tr key={i}>
                  <td style={{ width: 60 }}><span className="pill">{l.business}</span></td>
                  <td style={{ width: 90 }} className="muted">{l.gl_number}</td>
                  <td>
                    {l.gl_name || <span className="neg">not in this chart</span>}
                    {l.why && <div className="muted" style={{ fontSize: 11 }}>{l.why}</div>}
                    {l.memo && !l.why && <div className="muted" style={{ fontSize: 11 }}>{l.memo}</div>}
                  </td>
                  <td className="money" style={{ width: 100 }}>{num(l.debit) ? money(l.debit) : ''}</td>
                  <td className="money" style={{ width: 100 }}>{num(l.credit) ? money(l.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="bar" style={{ margin: '8px 0 0' }}>
            <button className="primary" onClick={applyPreview}>Apply to the draft</button>
            <button onClick={() => { setPreview(null); setProfile('') }}>Discard</button>
            <span className="muted" style={{ fontSize: 12 }}>
              Nothing is saved until you press Save entry below.
            </span>
          </div>
        </div>
      )}

      {/* ---- the editable draft ---- */}
      {lines && (
        <div className="note">
          <b>Draft entry</b>
          <table style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Entity</th>
                <th>Account</th>
                <th className="num" style={{ width: 120 }}>Debit</th>
                <th className="num" style={{ width: 120 }}>Credit</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select value={l.business} onChange={e => setLine(i, 'business', e.target.value)}>
                      <option value="">—</option>
                      {entities.map(b => <option key={b.code} value={b.code}>{b.code}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={l.account} onChange={e => setLine(i, 'account', e.target.value)}
                            disabled={!l.business} style={{ width: '100%' }}>
                      <option value="">—</option>
                      {accountsFor(l.business).map(a => (
                        <option key={a.number} value={a.number}>{a.number} — {a.name}</option>
                      ))}
                      {l.account && !accountsFor(l.business).some(a => a.number === l.account) && (
                        <option value={l.account}>{l.account} — not in this chart</option>
                      )}
                    </select>
                    {l.basis && <div className="muted" style={{ fontSize: 11 }}>{l.basis}</div>}
                  </td>
                  <td>
                    <input type="number" step="0.01" className="num" value={l.debit}
                           disabled={num(l.credit) > 0}
                           onChange={e => setLine(i, 'debit', e.target.value)} />
                  </td>
                  <td>
                    <input type="number" step="0.01" className="num" value={l.credit}
                           disabled={num(l.debit) > 0}
                           onChange={e => setLine(i, 'credit', e.target.value)} />
                  </td>
                  <td>
                    {lines.length > 2 && (
                      <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="bar" style={{ margin: '8px 0 0' }}>
            <button onClick={() => setLines(ls => [...ls, blank()])}>Add a line</button>
            <span style={{ flex: 1 }} />
            {Object.entries(perBiz).map(([b, v]) => (
              <span key={b} className="muted" style={{ fontSize: 12 }}>
                {b}: {money(v.d)} / {money(v.c)}
              </span>
            ))}
            <button onClick={() => { setLines(null); setMsg('') }}>Cancel</button>
            <button className="primary" disabled={!canSave || busy === 'save'} onClick={save}>
              {busy === 'save' ? 'Saving…' : 'Save entry'}
            </button>
          </div>

          {offBy.length > 0 && (
            <div className="note warn" style={{ marginTop: 8 }}>
              <b>Not balanced.</b>{' '}
              {offBy.map((x, i) => (
                <span key={x.business}>
                  {i > 0 && ' · '}{x.business} is out by {money(Math.abs(x.diff))}{' '}
                  ({x.diff > 0 ? 'debits exceed credits' : 'credits exceed debits'})
                </span>
              ))}
              <div className="fine">
                Each entity has to balance on its own. An entry balancing only in total would
                quietly move money between businesses.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
