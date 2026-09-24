import { useCallback, useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money } from './format.js'
import DocLink from './DocLink.jsx'

const num = v => Number(v) || 0

/**
 * Proposed entries — work something else prepared and nobody has agreed to yet.
 *
 * A proposal is not an entry. Nothing here is in the ledger; posting is what
 * puts it there, and until then the figures below affect no report. That is the
 * whole point of the pane: an importer or a scheduled task can prepare an entry
 * without being trusted to book it.
 *
 * Rejecting needs a reason, and the reason is kept — so the next run that
 * proposes the same thing can be answered by pointing at why it was refused,
 * rather than by refusing it again from scratch.
 */
export default function Proposals() {
  const [rows, setRows] = useState(null)
  const [lines, setLines] = useState({})
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [rejecting, setRejecting] = useState(null)
  const [why, setWhy] = useState('')

  const load = useCallback(async () => {
    setErr('')
    const { data, error } = await supabase.from('v_proposed_entries')
      .select('id,source,source_ref,entry_date,memo,storage_path,lines,debits,credits,ready,warnings,created_by,created_at')
      .order('entry_date')
    if (error) { setErr(error.message); return }
    setRows(data || [])

    if ((data || []).length) {
      const { data: ln } = await supabase.from('proposed_entry_lines')
        .select('proposal_id,line_no,business_code,gl_number,debit,credit,memo,settles_doc_no')
        .in('proposal_id', data.map(r => r.id))
        .order('proposal_id').order('line_no')
      const m = {}
      for (const l of ln || []) (m[l.proposal_id] ||= []).push(l)
      setLines(m)
    } else setLines({})
  }, [])

  useEffect(() => { load() }, [load])

  async function post(id) {
    setBusy(id); setErr(''); setMsg('')
    try {
      const r = await rpc('post_proposed_entry', { p_id: id, p_note: null })
      setMsg('Posted as ' + (typeof r === 'string' ? r : '?') + '.')
      await load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  async function reject(id) {
    if (!why.trim()) { setErr('A reason is required — it is kept so the next run can be answered.'); return }
    setBusy(id); setErr(''); setMsg('')
    try {
      const r = await rpc('reject_proposed_entry', { p_id: id, p_note: why.trim() })
      setMsg(typeof r === 'string' ? r : 'Rejected.')
      setRejecting(null); setWhy('')
      await load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  if (err && !rows) return <div className="page"><div className="err">{err}</div></div>
  if (!rows) return <div className="page"><div className="loading">Reading…</div></div>

  return (
    <div className="page">
      <p className="hint">
        Entries something else prepared and nobody has agreed to yet. <b>None of this is in the
        ledger</b> — it affects no report until it is posted. An importer or a scheduled task can
        propose an entry without being trusted to book one.
      </p>

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      {rows.length === 0 && (
        <div className="card"><div className="muted">Nothing proposed.</div></div>
      )}

      {rows.map(r => {
        const warn = String(r.warnings || '').split('§').filter(Boolean)
        const balanced = Math.abs(num(r.debits) - num(r.credits)) < 0.005
        return (
          <div className="card" key={r.id}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <b>{r.memo}</b>
              <span className="pill">{r.source}</span>
              {r.source_ref && <span className="muted">{r.source_ref}</span>}
              <span className="muted">{r.entry_date}</span>
              <span className={balanced ? 'pos' : 'neg'} style={{ fontSize: 12 }}>
                ${money(r.debits)} / ${money(r.credits)}
                {!balanced && ' — does not balance'}
              </span>
              <span style={{ flex: 1 }} />
              {r.storage_path && <DocLink path={r.storage_path} label="copy path" />}
              <button className="primary" disabled={!r.ready || !balanced || busy === r.id}
                      title={r.ready ? 'Writes it to the ledger.'
                                     : 'Not ready — see the warnings below.'}
                      onClick={() => post(r.id)}>
                {busy === r.id ? 'Posting…' : 'Post it'}
              </button>
              <button disabled={busy === r.id}
                      onClick={() => { setRejecting(rejecting === r.id ? null : r.id); setWhy('') }}>
                {rejecting === r.id ? 'Cancel' : 'Reject…'}
              </button>
            </div>

            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              proposed by {r.created_by} · {String(r.created_at || '').slice(0, 16).replace('T', ' ')}
            </div>

            {warn.length > 0 && (
              <div className="note warn" style={{ margin: '6px 0 0' }}>
                {warn.map((w, i) => <div key={i}>{w}</div>)}
              </div>
            )}

            <table style={{ marginTop: 6 }}>
              <tbody>
                {(lines[r.id] || []).map(l => (
                  <tr key={l.line_no}>
                    <td style={{ width: 60 }}><span className="pill">{l.business_code}</span></td>
                    <td style={{ width: 80 }} className="muted">{l.gl_number}</td>
                    <td>
                      {l.memo}
                      {l.settles_doc_no && (
                        <span className="pill soft" title="This line would mark that invoice paid.">
                          settles {l.settles_doc_no}
                        </span>
                      )}
                    </td>
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

            {rejecting === r.id && (
              <div className="bar" style={{ margin: '8px 0 0' }}>
                <span style={{ fontSize: 12.5 }}>Why is this being rejected?</span>
                <input value={why} onChange={e => setWhy(e.target.value)}
                       placeholder="e.g. already posted by hand"
                       style={{ flex: 1, minWidth: 260 }}
                       onKeyDown={e => { if (e.key === 'Enter') reject(r.id) }} />
                <button disabled={!why.trim() || busy === r.id} onClick={() => reject(r.id)}>
                  {busy === r.id ? 'Rejecting…' : 'Reject it'}
                </button>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  Kept with the proposal, so the next run that suggests the same thing can be
                  answered rather than argued with again.
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
