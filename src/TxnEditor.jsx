import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money } from './format.js'
import { useEntities } from './useEntities.js'
import ReceiptLines from './ReceiptLines.jsx'
import PayablesApply from './PayablesApply.jsx'
import DocumentList, { documentsCount } from './DocumentList.jsx'
import Section from './Section.jsx'
import ApBooked from './ApBooked.jsx'
import ThisIsA from './ThisIsA.jsx'

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
/** Which section opens first depends on the queue you are working. Documents
 *  always open when there are any — you cannot judge a row without them. */
const OPEN_FOR = {
  plain:    { entry: true },
  reopened: { entry: true },
  reviewed: { entry: true },
  apwait:   { entry: true },
  docs:     { pay: true },
}

export default function TxnEditor({ txn, kind, onDone }) {
  const opens = OPEN_FOR[kind] || (String(kind || '').startsWith('vg:') ? { entry: true } : { entry: true })
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
  const [projects, setProjects] = useState([])
  const [docCount, setDocCount] = useState('')
  const [apBooked, setApBooked] = useState('')
  const [applied, setApplied] = useState(null)
  const [openEntry, setOpenEntry] = useState(0)
  const [txnNote, setTxnNote] = useState('')
  const [bankAccounts, setBankAccounts] = useState([])
  const [xferTo, setXferTo] = useState('')
  const [splitState, setSplitState] = useState(0)
  const [preSplit, setPreSplit] = useState(null)
  const entities = useEntities()

  const load = useCallback(async () => {
    setErr(''); setLines(null); setApWarned(false)
    setSplitState(0); setPreSplit(null)
    try {
      const [seed, s, n, ap] = await Promise.all([
        rpc('web_txn_seed', { p_txn: txn.id }),
        rpc('suggest_journal', { p_txn: txn.id }).catch(() => []),
        supabase.from('transaction_notes')
          .select('id,note,status,reply,created_at')
          .eq('transaction_id', txn.id).order('created_at', { ascending: false })
          .then(({ data }) => data || []),
        rpc('web_txn_applied', { p_txn: txn.id }).catch(() => []),
      ])
      setApplied(ap && ap.length && ap[0].applied ? ap[0] : null)
      setSeedSource(seed.length ? seed[0].source : null)
      setLines(seed.map(l => ({
        business: l.business || '',
        account: l.account || '',
        debit: num(l.debit) || '',
        credit: num(l.credit) || '',
        basis: l.basis || '',
        projects: l.project_ids || [],
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
    supabase.from('projects').select('id,name').eq('active', true).order('name')
      .then(({ data }) => setProjects(data || []))
    supabase.from('accounts').select('id,name').eq('active', true).order('name')
      .then(({ data }) => setBankAccounts(data || []))
  }, [])

  // transactions.notes is a different thing from the notes queue: it rides
  // along with the entry in the same save, so it cannot be forgotten.
  useEffect(() => {
    supabase.from('transactions').select('notes').eq('id', txn.id).single()
      .then(({ data }) => setTxnNote((data && data.notes) || ''))
  }, [txn.id])

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

  /**
   * A profile FILLS the grid — it does not post anything and it does not lock
   * anything. The vehicle profile is usually fuel and sometimes maintenance,
   * so the account it fills in is a starting point to be changed, and the
   * project tags usually still have to go on by hand.
   *
   * Any project tags already on a line for the same business and account are
   * carried across, since the profile has no opinion about projects and
   * dropping them would be losing work the reader had already done.
   */
  const applyPreview = () => {
    const priorTags = {}
    for (const l of lines || []) {
      if ((l.projects || []).length) priorTags[`${l.business}|${l.account}`] = l.projects
    }
    setLines((preview || []).map(l => ({
      business: l.business || '', account: l.gl_number || '',
      debit: num(l.debit) || '', credit: num(l.credit) || '', basis: l.memo || '',
      projects: priorTags[`${l.business}|${l.gl_number}`] || [],
    })))
    setPreview(null); setProfile(''); setSeedSource('profile'); setApWarned(false)
    setOpenEntry(n => n + 1)
    setMsg('Filled into the draft below — every field is still editable. '
         + 'Change the accounts if this one was maintenance rather than fuel, '
         + 'tick any projects, then save. Check anything marked “not in this chart”.')
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

  /**
   * Halve — then quarter — every DEBIT line, leaving the credit side alone,
   * because the card was charged once. Largest-remainder, so the odd cents go
   * to the first shares and the split still adds back to the original: 367.77
   * into quarters is 91.95, 91.94, 91.94, 91.94, and doing that by hand four
   * times is where the arithmetic mistakes come from.
   *
   * The first share keeps the business and account already chosen. The rest
   * are left blank on purpose — whose the other share is, is a decision, not
   * something to guess.
   */
  function splitDebits(n, src) {
    const out = []
    for (const l of src) {
      const amt = num(l.debit)
      if (!amt) { out.push({ ...l }); continue }
      const base = Math.floor(amt / n * 100) / 100
      const short = Math.round((amt - base * n) * 100)
      for (let k = 0; k < n; k++) {
        out.push({
          ...l,
          debit: Number((base + (k < short ? 0.01 : 0)).toFixed(2)),
          credit: '',
          business: k === 0 ? l.business : '',
          account: k === 0 ? l.account : '',
          projects: k === 0 ? (l.projects || []) : [],
          basis: k === 0 ? l.basis
               : `Share ${k + 1} of ${n} — ${l.account ? l.account + ' ' : ''}pick the business and account`,
        })
      }
    }
    return out
  }

  function toggleSplit() {
    setMsg(''); setErr('')
    if (splitState === 0) {
      const src = (lines || []).map(l => ({ ...l }))
      setPreSplit(src); setLines(splitDebits(2, src)); setSplitState(2)
      setMsg('Split into 2. Pick the business and account on the new lines.')
    } else if (splitState === 2) {
      setLines(splitDebits(4, preSplit)); setSplitState(4)
      setMsg('Split into 4. Pick the business and account on the new lines.')
    } else {
      setLines(preSplit.map(l => ({ ...l }))); setPreSplit(null); setSplitState(0)
      setMsg('Split undone.')
    }
  }

  async function markReviewedOnly() {
    setBusy('markrev'); setErr(''); setMsg('')
    try {
      const r = await rpc('bulk_mark_reviewed', {
        p_ids: [txn.id],
        p_note: txnNote.trim() || 'Payable already cleared by this payment.',
      })
      setMsg((r && r[0] && r[0].outcome) || 'Marked reviewed.')
      if (onDone) onDone()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  async function recordTransfer() {
    if (!xferTo) { setErr('Pick the account on the other side first.'); return }
    setBusy('xfer'); setErr(''); setMsg('')
    try {
      await rpc('record_transfer', { p_txn: txn.id, p_other_account: xferTo })
      setMsg('Both sides recorded, and the matching charge on the other account is closed.')
      setXferTo('')
      await load()
      if (onDone) onDone()
    } catch (e) { setErr('Refused: ' + e.message) }
    setBusy('')
  }

  async function holdForInvoice() {
    setBusy('hold'); setErr(''); setMsg('')
    try {
      const r = await rpc('hold_for_invoice', {
        p_txn: txn.id, p_note: txnNote.trim() || null,
      })
      setMsg(typeof r === 'string' ? r : 'Held — it will come back when an invoice is matched to it.')
      if (onDone) onDone()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

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

      // set_journal_override does not carry projects, so they are applied
      // afterwards, matched on entity and account exactly as the console does.
      for (const l of filled) {
        if (!(l.projects || []).length) continue
        await rpc('tag_transaction_lines', {
          p_txn: txn.id, p_business: l.business,
          p_account: l.account, p_projects: l.projects,
        })
      }

      // The note goes with the entry, in the same save. A note that only
      // persists when you remember a separate button is a note you will lose.
      await supabase.from('transactions')
        .update({ notes: txnNote.trim() || null }).eq('id', txn.id)

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

      {/* This payment has already settled its invoice. It is here because
          belongs_in_invoice_queue() evicts an applied payment from queue 2 —
          rightly, there is nothing left to assign — and nothing catches it
          afterwards, so it lands in Allocate expenses. The expense was booked
          against the INVOICE date. Coding it again would double the cost. */}
      {applied && (
        <div className="note bad" style={{ marginBottom: 8 }}>
          <b>Already applied to an invoice — do not code this as an expense.</b>
          <div style={{ marginTop: 3 }}>
            Settles {applied.invoices || 'an invoice'}
            {num(applied.settled_amount) ? ` · $${money(applied.settled_amount)}` : ''}.
            {applied.entries
              ? ` The payment side is ${applied.entries}.`
              : ' The payment side has not been written yet.'}
          </div>
          {applied.entries && txn.status !== 'reviewed' && (
            <div style={{ marginTop: 7 }}>
              <button disabled={!!busy} onClick={markReviewedOnly}>
                {busy === 'markrev' ? 'Marking…' : 'Mark reviewed — nothing more to post'}
              </button>
            </div>
          )}
        </div>
      )}

      <Section title="Source documents" count={docCount} defaultOpen
               tone={/no file/.test(docCount) ? 'warn' : ''}>
        <DocumentList txnId={txn.id} onChanged={onDone} onCount={setDocCount} />
      </Section>

      {txn.direction === 'outflow' && (
        <Section title="Apply this payment to invoices" defaultOpen={!!opens.pay}>
          <PayablesApply txn={txn} onDone={load} />
        </Section>
      )}

      {/* Booked to payables here. Opens by itself when there is one: it is the
          reason NOT to code this as an expense, so it cannot be behind a fold
          you have to know to open. */}
      {/* Rendered but hidden until it reports a vendor, because whether there
          is one is only known once it has read. An empty fold header saying
          "Booked to payables here" on a transaction with no payable behind it
          would be a lie you have to open to disprove. */}
      <div style={apBooked ? undefined : { display: 'none' }}>
        <Section title="Booked to payables here" count={apBooked}
                 key={'ap' + String(!!apBooked)} defaultOpen={!!apBooked}>
          <ApBooked txnId={txn.id} onDone={onDone} onCount={setApBooked} />
        </Section>
      </div>

      {/* With no document there is no per-document "This is a …", and the row
          that most needs one is exactly that kind: T003913, an ATM deposit
          with nothing attached, sitting in Allocate expenses. So the control
          appears on its own when the documents fold has nothing in it. */}
      {!docCount && (
        <div style={{ marginBottom: 8 }}>
          <ThisIsA txnId={txn.id} onDone={onDone}
                   label="This is a" />
        </div>
      )}

      {/* The console keeps this outside the folds: it is the exit for a row
          that should never have been in a coding queue at all, and burying
          it inside Entry would mean opening Entry to say "this is not one". */}
      <div className="bar" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 560 }}>This is a transfer to</span>
        <select value={xferTo} onChange={e => setXferTo(e.target.value)}
                style={{ minWidth: 200 }}>
          <option value="">— pick the other account —</option>
          {bankAccounts.filter(a => a.id !== txn.account_id).map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <button disabled={!xferTo || !!busy} onClick={recordTransfer}>
          {busy === 'xfer' ? 'Recording…' : 'Record both sides'}
        </button>
        <span className="muted" style={{ fontSize: 11.5 }}>
          Writes both ledgers and closes the matching charge on the other account.
        </span>
      </div>

      <Section title="The document, line by line" defaultOpen={false}>
        <ReceiptLines txnId={txn.id} />
      </Section>

      {/* ---- notes: what the morning task reads ---- */}
      <Section title="Notes" defaultOpen={false}
               count={notes.filter(n => n.status === 'open').length
                        ? notes.filter(n => n.status === 'open').length + ' open' : ''}>
      <div>
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
      </Section>

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
            <button className="primary" onClick={applyPreview}>Fill the draft with this</button>
            <button onClick={() => { setPreview(null); setProfile('') }}>Discard</button>
            <span className="muted" style={{ fontSize: 12 }}>
              It only fills the grid — accounts, amounts and projects all stay editable,
              and nothing is saved until you press Save.
            </span>
          </div>
        </div>
      )}

      {/* ---- the draft, always seeded ---- */}
      {!lines && <div className="loading">Reading…</div>}
      {lines && (
        <Section title="Entry" defaultOpen={!!opens.entry} openSignal={openEntry}
                 tone={offBy.length ? 'warn' : ''}
                 count={lines.length
                   ? `${filled.length} line${filled.length === 1 ? '' : 's'}`
                     + (offBy.length ? ' · does not balance' : ' · balances')
                   : 'empty'}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
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
                <th style={{ width: 150 }}>Projects</th>
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
                  <td style={{ fontSize: 11 }}>
                    {/* Tick boxes, not a multi-select: a line can carry several
                        projects, and a list where ctrl-click is the only way to
                        pick a second one reads as "choose one". */}
                    <div className="tickbox">
                      {projects.length === 0 && <span className="muted">no active projects</span>}
                      {projects.map(p => {
                        const on = (l.projects || []).includes(p.id)
                        return (
                          <label key={p.id} className="tick">
                            <input type="checkbox" checked={on}
                                   onChange={() => setLine(i, 'projects',
                                     on ? (l.projects || []).filter(x => x !== p.id)
                                        : [...(l.projects || []), p.id])} />
                            {p.name}
                          </label>
                        )
                      })}
                    </div>
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
            <button onClick={toggleSplit} disabled={!(lines || []).some(l => num(l.debit))}
                    title="Halves every debit line and leaves the credit alone — the card was charged once.">
              {splitState === 0 ? 'Split the debits in 2'
                : splitState === 2 ? 'Split into 4'
                : 'Undo the split'}
            </button>
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
            <button disabled={!!busy} onClick={holdForInvoice}
                    title="Posts nothing. Moves this to the waiting queue until an invoice is matched to it, then it comes back here.">
              {busy === 'hold' ? 'Holding…' : 'Hold for the invoice'}
            </button>
          </div>

          <div className="bar" style={{ margin: '8px 0 0' }}>
            <label htmlFor="txnNote">Note</label>
            <input id="txnNote" value={txnNote} onChange={e => setTxnNote(e.target.value)}
                   placeholder="Saved with the entry — what this was, in your words"
                   style={{ flex: 1, minWidth: 260 }} />
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
        </Section>
      )}
    </div>
  )
}
