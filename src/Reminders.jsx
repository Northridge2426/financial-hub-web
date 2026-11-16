import { useCallback, useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'

// Attention levels — how soon William needs to look. Set per reminder in the database
// (reminders.attention); blocking reminders are forced to urgent by a trigger.
const LEVELS = [
  { k: 'urgent',    label: 'Urgent',    hint: 'deal with this now' },
  { k: 'high',      label: 'High',      hint: 'needs you soon' },
  { k: 'medium',    label: 'Medium',    hint: 'when you have time' },
  { k: 'low',       label: 'Low',       hint: 'tidy-ups, can wait' },
  { k: 'reference', label: 'Reference', hint: 'standing rules and watch items — no action' },
]

const CATLBL = {
  gst: 'GST', ledger: 'The ledger', documents: 'Documents',
  payables: 'Payables', revenue: 'Revenue', general: 'Other',
}

export default function Reminders() {
  const [who, setWho] = useState('')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [closing, setClosing] = useState(null)
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ title: '', detail: '', category: 'general', waiting_on: 'william', priority: 50, attention: 'medium' })
  const [showRef, setShowRef] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setErr('')
    try {
      const [items, outstanding] = await Promise.all([
        rpc('web_reminders'),
        supabase.from('v_reports_outstanding')
          .select('processor,business_code,cadence,inbox_folder,period,days_late')
          .then(({ data, error }) => { if (error) throw new Error(error.message); return data || [] }),
      ])
      setData({ items, outstanding })
    } catch (e) { setErr(e.message) }
  }, [])

  useEffect(() => { setData(null); load() }, [load])

  async function close(id) {
    try {
      await rpc('close_reminder', { p_id: id, p_note: note.trim() || null })
      setClosing(null); setNote('')
      setData(null); await load()
    } catch (e) { setErr(e.message) }
  }

  async function setLevel(id, attention) {
    setErr(''); setMsg('')
    try {
      const r = await rpc('set_reminder_attention', { p_id: id, p_attention: attention, p_why: null })
      setMsg(typeof r === 'string' ? r : 'Updated.')
      await load()
    } catch (e) { setErr(e.message) }
  }

  if (err && !data) return <div className="page"><div className="err">{err}</div></div>
  if (!data) return <div className="page"><div className="loading">Loading…</div></div>

  const all = data.items
  const rows = who ? all.filter(r => r.waiting_on === who || r.waiting_on === 'either') : all
  const live = rows.filter(r => r.kind === 'live')
  const items = rows.filter(r => r.kind === 'item')
  const byLevel = LEVELS.map(l => ({ ...l, rows: items.filter(r => (r.attention || 'medium') === l.k) }))
  const late = data.outstanding.filter(r => Number(r.days_late) > 0)

  async function addOne() {
    if (!draft.title.trim()) return
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await rpc('web_add_reminder', {
        p_title: draft.title.trim(),
        p_detail: draft.detail.trim() || null,
        p_category: draft.category,
        p_waiting_on: draft.waiting_on,
        p_priority: Number(draft.priority) || 50,
        p_attention: draft.attention,
      })
      setMsg(typeof r === 'string' ? r : 'Added.')
      setDraft({ title: '', detail: '', category: 'general', waiting_on: 'william', priority: 50, attention: 'medium' })
      setAdding(false)
      await load()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="page">
      {msg && <div className="note good">{msg}</div>}

      <div className="bar">
        <select value={who} onChange={e => setWho(e.target.value)}>
          <option value="">Everyone</option>
          <option value="william">Mine</option>
          <option value="claude">Claude's</option>
        </select>
        <span className="muted" style={{ fontSize: 12 }}>
          {items.length} open · {live.length} counted from the data
        </span>
        {byLevel.filter(l => l.rows.length > 0).map(l => (
          <span key={l.k} className={'att att-' + l.k} title={l.hint}>{l.label} {l.rows.length}</span>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={() => setAdding(a => !a)}>{adding ? 'Cancel' : 'New reminder'}</button>
      </div>

      {adding && (
        <div className="card">
          <h2>A new reminder</h2>
          <div className="bar" style={{ margin: 0 }}>
            <input value={draft.title} placeholder="What needs doing"
                   style={{ flex: 1, minWidth: 260 }}
                   onChange={e => setDraft({ ...draft, title: e.target.value })}
                   onKeyDown={e => { if (e.key === 'Enter' && draft.title.trim()) addOne() }} />
            <select value={draft.waiting_on}
                    onChange={e => setDraft({ ...draft, waiting_on: e.target.value })}>
              <option value="william">Mine</option>
              <option value="claude">Claude's</option>
              <option value="either">Either</option>
            </select>
            <select value={draft.category}
                    onChange={e => setDraft({ ...draft, category: e.target.value })}>
              <option value="general">general</option>
              <option value="gst">gst</option>
              <option value="bank">bank</option>
              <option value="documents">documents</option>
              <option value="ledger">ledger</option>
            </select>
            <select value={draft.attention} aria-label="Attention level"
                    className={'att-select att-' + draft.attention}
                    onChange={e => setDraft({ ...draft, attention: e.target.value })}>
              {LEVELS.map(l => <option key={l.k} value={l.k}>{l.label}</option>)}
            </select>
            <label htmlFor="rmPri">Priority</label>
            <input id="rmPri" type="number" min="1" max="99" value={draft.priority} style={{ width: 80 }}
                   onChange={e => setDraft({ ...draft, priority: e.target.value })} />
            <button className="primary" disabled={!draft.title.trim() || busy} onClick={addOne}>
              {busy ? 'Adding…' : 'Add it'}
            </button>
          </div>
          <input value={draft.detail} placeholder="Anything the title does not say"
                 style={{ marginTop: 6 }}
                 onChange={e => setDraft({ ...draft, detail: e.target.value })} />
          <p className="hint" style={{ margin: '6px 0 0' }}>
            This is an <b>item</b> — something a person has to do. The reminders counted from the
            data below are computed and cannot be added or closed by hand; they go away when the
            thing they are counting does.
          </p>
        </div>
      )}

      {err && <div className="err">{err}</div>}

      {/* Reports first: everything below is work on figures that are already in.
          A missing report means a whole month of a business is simply absent,
          which no count further down can tell you. */}
      <div className="card">
        <h2>
          Reports
          {late.length > 0 && <span className="neg"> — {late.length} overdue</span>}
        </h2>
        {data.outstanding.length === 0 ? (
          <div className="muted">Every expected report is in.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Processor</th>
                <th style={{ width: 70 }}>Entity</th>
                <th style={{ width: 110 }}>Cadence</th>
                <th style={{ width: 130 }}>Period missing</th>
                <th style={{ width: 120 }}>How late</th>
                <th>Drop it in</th>
              </tr>
            </thead>
            <tbody>
              {data.outstanding.map((r, i) => (
                <tr key={i}>
                  <td><b>{r.processor}</b></td>
                  <td><span className="pill">{r.business_code}</span></td>
                  <td className="muted">{r.cadence}</td>
                  <td>{r.period}</td>
                  <td>
                    {Number(r.days_late) > 0
                      ? <span className="pill hold">{r.days_late}d late</span>
                      : <span className="muted">not due yet</span>}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{r.inbox_folder || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint" style={{ margin: '8px 0 0' }}>
          A month counts as covered if any filed report's period spans it, so one quarterly
          statement satisfies its three months. Nothing is chased until a month after the period
          closed. Drop new reports in the matching <code>_Inbox</code> folder and the sweep files
          them.
        </p>
      </div>

      {live.length > 0 && (
        <div className="card">
          <h2>Counted from the data, now</h2>
          <table>
            <tbody>
              {live.map(r => (
                <tr key={r.id}>
                  <td style={{ width: '34%' }}><b>{r.title}</b></td>
                  <td className="muted">{r.detail}</td>
                  <td className="money" style={{ width: 80 }}><b>{r.n}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {byLevel.filter(l => l.rows.length > 0).map(l => (
        <div className={'card att-card att-card-' + l.k} key={l.k}>
          <h2>
            <span className={'att att-' + l.k}>{l.label}</span>
            <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>
              {l.rows.length} · {l.hint}
            </span>
            {l.k === 'reference' && (
              <button style={{ marginLeft: 10 }} onClick={() => setShowRef(v => !v)}>
                {showRef ? 'Hide' : 'Show'}
              </button>
            )}
          </h2>
          {(l.k !== 'reference' || showRef) && (
          <table>
            <tbody>
              {l.rows.map(r => [
                <tr key={r.id}>
                  <td style={{ width: '34%' }}>
                    <b>{r.title}</b>
                    {r.attention_why && <div className="att-why">{r.attention_why}</div>}
                    <div className="muted" style={{ fontSize: 11 }}>
                      raised {r.raised_on} · {CATLBL[r.category] || r.category}
                    </div>
                  </td>
                  <td className="muted">{r.detail}</td>
                  <td style={{ width: 110 }}>
                    <select value={r.attention || 'medium'} aria-label="Attention level"
                            className={'att-select att-' + (r.attention || 'medium')}
                            disabled={r.blocking}
                            title={r.blocking ? 'Blocking work — stays urgent until closed' : 'Change the level'}
                            onChange={e => setLevel(r.id, e.target.value)}>
                      {LEVELS.map(x => <option key={x.k} value={x.k}>{x.label}</option>)}
                    </select>
                  </td>
                  <td style={{ width: 70 }}>
                    <span className={'pill ' + (r.waiting_on === 'william' ? 'hold' : '')}>
                      {r.waiting_on === 'william' ? 'you' : r.waiting_on}
                    </span>
                  </td>
                  <td style={{ width: 70 }}>
                    <button onClick={() => { setClosing(r.id); setNote('') }}>Done</button>
                  </td>
                </tr>,
                closing === r.id && (
                  <tr key={r.id + '-c'} className="expand">
                    <td colSpan={5}>
                      <div className="bar" style={{ margin: 0 }}>
                        <label htmlFor={'n' + r.id}>Anything worth recording?</label>
                        <input id={'n' + r.id} value={note} placeholder="optional"
                               onChange={e => setNote(e.target.value)} style={{ width: 300 }} />
                        <button className="primary" onClick={() => close(r.id)}>Close it</button>
                        <button onClick={() => setClosing(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                ),
              ])}
            </tbody>
          </table>
          )}
        </div>
      ))}

      {items.length === 0 && live.length === 0 && (
        <div className="card"><div className="muted">Nothing outstanding.</div></div>
      )}
    </div>
  )
}
