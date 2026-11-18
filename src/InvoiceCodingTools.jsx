import { useCallback, useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money } from './format.js'

const num = v => Number(v) || 0

/** The grid's line shape, from any of the web_invoice_* functions that fill it. */
export const toGridLines = rows => (rows || []).map(l => ({
  business: l.business || '',
  account: l.account || '',
  debit: num(l.debit) || '',
  credit: num(l.credit) || '',
  role: l.role === 'gst' ? 'gst' : l.role === 'payable' ? 'payable' : 'expense',
  projects: l.project_ids || [],
}))

/**
 * Saved allocations on an invoice — pick one to fill the grid, or save the
 * split on the grid under a name.
 *
 * These are the same saved allocations as the Saved allocations page and the
 * transaction editor: one list, not a second one for invoices. Applying one
 * FILLS the grid and posts nothing; every field stays editable.
 *
 * Saving keeps each entity's share of the pre-tax amount, the account where an
 * entity uses only one, and project tags where an entity's lines agree. The
 * percentages, not the dollars, are what is kept — so it fits next month's
 * bill when the amount moves. A name already in use is refused, never
 * overwritten (web_save_invoice_allocation).
 */
export function SavedAllocationBar({ receiptId, lines, onApply }) {
  const [profiles, setProfiles] = useState([])
  const [pick, setPick] = useState('')
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const loadProfiles = useCallback(() => {
    supabase.from('allocation_profiles').select('code,name').order('name')
      .then(({ data, error }) => error ? setErr(error.message) : setProfiles(data || []))
  }, [])
  useEffect(loadProfiles, [loadProfiles])

  async function apply(code) {
    setPick(code); setErr(''); setMsg('')
    if (!code) return
    setBusy('apply')
    try {
      const rows = await rpc('web_invoice_apply_allocation', { p_receipt: receiptId, p_profile: code })
      onApply(toGridLines(rows))
      const p = profiles.find(x => x.code === code)
      const open = rows.some(r => r.role === 'expense' && !r.account)
      setMsg(`Filled from "${p ? p.name : code}".`
        + (open ? ' Pick the expense account where it is blank — this allocation leaves it open.' : '')
        + ' Nothing is booked until you press Book it.')
    } catch (e) { setErr(e.message) }
    setPick(''); setBusy('')
  }

  async function save() {
    setBusy('save'); setErr(''); setMsg('')
    try {
      const res = await rpc('web_save_invoice_allocation', {
        p_name: name.trim(),
        p_receipt: receiptId,
        p_lines: (lines || [])
          .filter(l => l.business && l.account && (num(l.debit) || num(l.credit)))
          .map(l => ({
            business: l.business, account: l.account,
            debit: num(l.debit), credit: num(l.credit),
            projects: l.projects || [],
          })),
      })
      setMsg(typeof res === 'string' ? res : 'Saved.')
      setSaving(false); setName('')
      loadProfiles()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  const hasExpense = (lines || []).some(l => l.role === 'expense' && l.business && l.account
                                         && (num(l.debit) || num(l.credit)))

  return (
    <div style={{ marginBottom: 8 }}>
      <div className="bar" style={{ margin: 0 }}>
        <label>Saved allocation</label>
        <select value={pick} disabled={!!busy} style={{ minWidth: 280 }}
                onChange={e => apply(e.target.value)}>
          <option value="">— apply a saved allocation —</option>
          {profiles.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
        </select>
        {busy === 'apply' && <span className="muted">Filling…</span>}
        <span style={{ flex: 1 }} />
        {!saving && (
          <button disabled={!hasExpense || !!busy} onClick={() => { setSaving(true); setMsg(''); setErr('') }}
                  title={hasExpense ? 'Keep this split to use again'
                                    : 'Code at least one expense line first'}>
            Save this allocation…
          </button>
        )}
        {saving && (
          <>
            <input value={name} autoFocus placeholder="Name it — e.g. Northwestel, salon / apartments"
                   style={{ width: 300 }} onChange={e => setName(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter' && name.trim()) save(); if (e.key === 'Escape') setSaving(false) }} />
            <button className="primary" disabled={!name.trim() || !!busy} onClick={save}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setSaving(false); setName('') }}>Cancel</button>
          </>
        )}
      </div>
      {saving && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
          Keeps each entity's share of the pre-tax amount, its expense account (where it uses only
          one) and its project tags. Saved as percentages, so it fits a bill of a different amount.
        </div>
      )}
      {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
      {msg && <div className="note good" style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  )
}

/**
 * Recommended coding — how this vendor's earlier invoices were booked.
 *
 * Lists the most recent booked invoices from the same vendor, each as it was
 * posted. "Use this coding" copies one onto the invoice in front of you through
 * web_invoice_coding_from: same entities, accounts and project tags, scaled to
 * this invoice's amount (identical when the amount is identical), GST following
 * the earlier GST split, a payable per entity. It fills the Entry grid; nothing
 * is booked until Book it is pressed.
 *
 *   onUse(lines, source)   grid lines and the source invoice row
 *   onCount(n)             how many were found, for the tab's badge
 */
export function RecommendedCoding({ receiptId, onUse, onCount }) {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    setRows(null); setErr('')
    rpc('web_invoice_recommended', { p_receipt: receiptId })
      .then(r => { setRows(r); onCount && onCount(r.length) })
      .catch(e => { setErr(e.message); onCount && onCount(null) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId])

  async function use(src) {
    setBusy(src.receipt_id); setErr('')
    try {
      const lines = await rpc('web_invoice_coding_from', { p_receipt: receiptId, p_source: src.receipt_id })
      onUse(toGridLines(lines), src)
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  if (err) return <div className="err">{err}</div>
  if (!rows) return <div className="loading">Looking for earlier invoices from this vendor…</div>
  if (rows.length === 0) {
    return (
      <div className="muted" style={{ padding: '8px 0' }}>
        No earlier booked invoice from this vendor. Once one is booked it will be offered here
        next time — or save this one's split as a saved allocation from the Entry tab.
      </div>
    )
  }

  return (
    <div>
      <p className="hint" style={{ margin: '0 0 8px' }}>
        How this vendor's earlier invoices were booked, most recent first. <b>Use this coding</b> copies
        the entities, accounts and project tags onto this invoice, scaled to its amount, and opens the
        Entry tab to check before booking.
      </p>
      {rows.map((s, k) => {
        const ls = s.lines || []
        const dr = ls.reduce((a, l) => a + num(l.debit), 0)
        const cr = ls.reduce((a, l) => a + num(l.credit), 0)
        return (
          <div key={s.receipt_id} className="card" style={{ margin: '0 0 8px', padding: 10 }}>
            <div className="bar" style={{ margin: '0 0 6px' }}>
              <b>{s.doc_no || 'no number'}</b>
              <span className="muted">{s.doc_date}</span>
              {!s.exact_vendor && <span className="muted">{s.vendor}</span>}
              {s.reference && <span className="muted">{s.reference}</span>}
              <span className="money">${money(Math.abs(num(s.amount)))}</span>
              {k === 0 && <span className="pill">most recent</span>}
              {s.same_amount
                ? <span className="pill soft">same amount — copies exactly</span>
                : <span className="pill hold">different amount — scaled to this one</span>}
              <span style={{ flex: 1 }} />
              <button className={k === 0 ? 'primary' : ''} disabled={!!busy} onClick={() => use(s)}>
                {busy === s.receipt_id ? 'Copying…' : 'Use this coding'}
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Entity</th>
                  <th>Account</th>
                  <th className="num" style={{ width: 100 }}>Debit</th>
                  <th className="num" style={{ width: 100 }}>Credit</th>
                  <th style={{ width: 180 }}>Projects</th>
                </tr>
              </thead>
              <tbody>
                {ls.map((l, i) => (
                  <tr key={i} className={l.role === 'expense' ? '' : 'muted'}>
                    <td><span className="pill">{l.business}</span></td>
                    <td>{l.account} — {l.gl_name}</td>
                    <td className="money">{num(l.debit) ? money(l.debit) : ''}</td>
                    <td className="money">{num(l.credit) ? money(l.credit) : ''}</td>
                    <td style={{ fontSize: 11 }}>{(l.projects || []).join(', ')}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={2} />
                  <td className="money">{money(dr)}</td>
                  <td className="money">{money(cr)}</td>
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
