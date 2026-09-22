import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money } from './format.js'
import { useEntities } from './useEntities.js'
import ReceiptLines from './ReceiptLines.jsx'
import PayablesApply from './PayablesApply.jsx'
import DocumentList from './DocumentList.jsx'

const num = v => Number(v) || 0
const blank = () => ({ business: '', account: '', debit: '', credit: '', basis: '' })

const SOURCE_LABEL = {
  override:  'the entry already saved against this transaction',
  sage:      'the Sage entry it is reconciled to, exactly as booked',
  suggested: 'what the ledger has done with this vendor before',
  blank:     'the account it was paid from — the expense side is yours to fill',
  funding:   'the account it was paid from — the expense side is yours to fill',
}

/**
 * Coding one transaction.
 *
 * The draft is SEEDED, never blank. `web_txn_seed` mirrors the console's
 * cascade: an existing override, else the Sage entry as booked, else
 * suggest_journal(), else a blank expense line plus the funding side taken from
 * the account the transaction sits on. Opening a card payment with two empty
 * rows makes you retype what the system already knows.
 *
 * Saving has two outcomes, as the console does:
 *   Save                  -> status 'in_review'; it stays in the queue
 *   Save and mark reviewed -> bulk_mark_reviewed(), which refuses if the entry
 *                             is missing or out of balance, and it leaves
 *
 * An entry that debits 2100 gets a warning first: `set_journal_override` writes
 * plain lines with no `settles_receipt_id`, and that stamp is the only thing
 * marking an invoice paid. Saving an AP debit here posts the cash side and
 * leaves the payable outstanding — it half works, which is worse than failing.
 */
export default function TxnEditor({ txn, onDone }) {
  const [seedSource, setSeedSource] = useState(null)
  const [suggestion, setSuggestion] = useState([])
  const [profiles, setProfiles] = useState([])
  const [accounts, setAccounts] = useState([])
  const [profile, setProfile] = useState('')
  const [preview, setPreview] = useState(null)
  const [lines, setLines] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [notes, setNotes] = useState([])
  const [noteText, setNoteText] = useState('')
  const [apWarned, setApWarned] = useState(false)
  const entities = useEntities()

  const load = useCallback(async () => {
    setErr(''); setLines(null); setApWarned(false)
    try {
      const [seed, s, n] = await Promise.all([
        rpc('web_txn_seed', { p_txn: txn.id }),
        rpc('suggest_journal', { p_txn: txn.id }).catch(() => []),
        supabase.from('transaction_notes')
          .select('id,note,status,reply,created_at')
          .eq('transaction_id', txn.id).order('created_at', { ascending: false })
          .then(({ data }) => data || []),
      ])
      setSeedSource(seed.length ? seed[0].source : null)
      setLines(seed.map(l => ({
        business: l.business || '',
        account: l.account || '',
        debit: num(l.debit) || '',
        credit: num(l.credit) || '',
        basis: l.basis || '',
      })))
      setSuggestion(s); setNotes(n)
    } catch (e) { setErr(e.message) }
  }, [txn.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    supabase.from('allocation_profiles').select('code,name').order('name')
      .then(({ data }) => setProfiles(data || []))
    supabase.from('v_chart_of_accounts').select('business,number,name')
      .eq('usable', true).eq('postable', true).order('business').order('number')
      .then(({ data }) => setAccounts(data || []))
  }, [])

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
      business: l.business || '', account: l.gl_number || '',
      debit: num(l.debit) || '', credit: num(l.credit) || '', basis: l.memo || '',
    })))
    setPreview(null); setProfile(''); setSeedSource('profile'); setApWarned(false)
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
  const apDebit = filled.some(l => l.account === '2100' && num(l.debit) > 0)

  async function save(markReviewed) {
    // Settling a payable is not a journal edit. Warn once, allow on a second press.
    if (apDebit && !apWarned) {
      setApWarned(true)
      setErr('This entry debits Accounts Payable, so it looks like it is settling an invoice. '
           + 'Use “Apply this payment to invoices” above — otherwise the payment posts while the '
           + 'payable stays outstanding. Press again to save it as is.')
      return
    }
    setBusy(markReviewed ? 'saverev' : 'save'); setErr(''); setMsg('')
    try {
      const payload = filled.map(l => ({
        business: l.business, account: l.account,
        debit: num(l.debit) || 0, credit: num(l.credit) || 0,
      }))
      await rpc('set_journal_override', { p_txn: txn.id, p_lines: payload })

      if (markReviewed) {
        const out = await rpc('bulk_mark_reviewed', {
          p_ids: [txn.id], p_note: 'Reviewed on the web console',
        })
        const outcome = (out && out[0] && out[0].outcome) || 'reviewed'
        if (/skipped/i.test(outcome)) {
          setErr(`Saved, but not marked reviewed — ${outcome}.`)
        } else {
          setMsg(`${txn.ref} saved and reviewed.`)
          if (onDone) { onDone(); return }
        }
      } else {
        const { error } = await supabase.from('transactions')
          .update({ status: 'in_review' }).eq('id', txn.id)
        if (error) throw new Error(error.message)
        setMsg('Entry saved. Still in the queue — use “Save and mark reviewed” when it is settled.')
      }
      setApWarned(false)
      await load()
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

      <DocumentList txnId={txn.id} />

      {txn.direction === 'outflow' && <PayablesApply txn={txn} onDone={load} />}

      <ReceiptLines txnId={txn.id} />

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
                    {n.reply && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>↳ {n.reply}</div>}
                  </td>
                  <td style={{ width: 90 }}>
                    <span className={'pill ' + (n.status === 'open' ? 'hold' : 'soft')}>{n.status}</span>
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
      <div className="bar" style={{ margin: '0 0 8px' }}>
        <label>Allocation</label>
        <select value={profile} onChange={e => pickProfile(e.target.value)} style={{ minWidth: 300 }}>
          <option value="">— apply a profile instead —</option>
          {profiles.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
        </select>
        {busy === 'preview' && <span className="muted">Building it…</span>}
        <span style={{ flex: 1 }} />
        {suggestion.length > 0 && (
          <span className="muted" style={{ fontSize: 12 }}>
            {suggestion.length} prior posting{suggestion.length === 1 ? '' : 's'} for this vendor
          </span>
        )}
      </div>

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
                    {(l.why || l.memo) && (
                      <div className="muted" style={{ fontSize: 11 }}>{l.why || l.memo}</div>
                    )}
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
            <span className="muted" style={{ fontSize: 12 }}>Nothing is saved until you press Save.</span>
          </div>
        </div>
      )}

      {/* ---- the draft, always seeded ---- */}
      {!lines && <div className="loading">Reading…</div>}
      {lines && (
        <div className="note">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <b>Entry</b>
            {seedSource && SOURCE_LABEL[seedSource] && (
              <span className="muted" style={{ fontSize: 12 }}>
                prefilled from {SOURCE_LABEL[seedSource]}
              </span>
            )}
          </div>

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
            <button onClick={load}>Reset</button>
            <span style={{ flex: 1 }} />
            {Object.entries(perBiz).map(([b, v]) => (
              <span key={b} className="muted" style={{ fontSize: 12 }}>
                {b}: {money(v.d)} / {money(v.c)}
              </span>
            ))}
            <button disabled={!canSave || !!busy} onClick={() => save(false)}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            <button className="primary" disabled={!canSave || !!busy} onClick={() => save(true)}>
              {busy === 'saverev' ? 'Saving…'
                : apDebit && apWarned ? 'Save anyway — no invoice marked paid'
                : 'Save and mark reviewed'}
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
