import { useCallback, useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'
import { EntryDetail } from './GeneralJournal.jsx'
import TxnEditor from './TxnEditor.jsx'

const num = v => Number(v) || 0
const signed = v => (num(v) < 0 ? '−$' : '$') + money(Math.abs(num(v)))

/**
 * The ledger lines behind one project figure — a whole project, or one
 * entity + account row of it — and, one click further, the entry each line
 * belongs to with its documents.
 *
 * Each line carries a note that belongs to the line AS PART OF THIS PROJECT:
 * the Starlink bill can say one thing under Cabin and another under Kris. The
 * note is keyed on the line's source document, entity and account rather than
 * the line's id, because re-coding a transaction rebuilds its lines with new
 * ids and would otherwise lose every note on it.
 */
export default function ProjectLines({ project, from, to, business, glNumber, onChanged }) {
  const [lines, setLines] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)

  const load = useCallback(() => {
    setErr('')
    return rpc('web_project_lines', {
      p_project: project, p_from: from, p_to: to || null,
      p_business: business || null, p_gl_number: glNumber || null,
    }).then(setLines).catch(e => setErr(e.message))
  }, [project, from, to, business, glNumber])

  useEffect(() => { setLines(null); setOpen(null); load() }, [load])

  if (err) return <div className="err">{err}</div>
  if (!lines) return <div className="loading">Reading the lines…</div>
  if (!lines.length) return <div className="muted">No lines in this period.</div>

  const showAccount = !glNumber
  const cols = showAccount ? 9 : 8
  const net = lines.reduce((a, l) => a + num(l.net), 0)

  return (
    <>
      <b style={{ fontSize: 12.5 }}>
        {lines.length} line{lines.length === 1 ? '' : 's'} · net {signed(net)}
      </b>
      <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
        Click a line to see its entry and documents.
      </span>
      <table style={{ marginTop: 3 }}>
        <thead>
          <tr>
            <th style={{ width: 88 }}>Date</th>
            <th style={{ width: 58 }}>Entry</th>
            <th style={{ width: 84 }}>Ref</th>
            {showAccount && <th style={{ width: 170 }}>Account</th>}
            <th>Description</th>
            <th className="num" style={{ width: 92 }}>Debit</th>
            <th className="num" style={{ width: 92 }}>Credit</th>
            <th className="num" style={{ width: 96 }}>Net</th>
            <th style={{ width: '24%' }}>Project note</th>
          </tr>
        </thead>
        <tbody>
          {lines.flatMap(l => {
            const isOpen = open === l.line_id
            return [
              <tr key={l.line_id} className={'drill' + (isOpen ? ' rowsel' : '')}
                  onClick={() => setOpen(isOpen ? null : l.line_id)}>
                <td>{l.entry_date}</td>
                <td className="muted">{l.entry_no || ''}</td>
                <td className="muted">{l.ref || ''}</td>
                {showAccount && (
                  <td style={{ fontSize: 12 }}>
                    <span className="pill">{l.business}</span>{' '}
                    <span className="muted">{l.gl_number}</span> {l.account}
                  </td>
                )}
                <td>
                  {l.description}
                  {num(l.docs) > 0 &&
                    <span className="pill soft">{l.docs} doc{num(l.docs) === 1 ? '' : 's'}</span>}
                  {l.other_projects &&
                    <span className="pill hold" title="This line is also tagged to these projects, in full.">
                      also {l.other_projects}
                    </span>}
                </td>
                <td className="money">{num(l.debit) ? money(l.debit) : ''}</td>
                <td className="money">{num(l.credit) ? money(l.credit) : ''}</td>
                <td className={'money ' + (num(l.net) < 0 ? 'neg' : '')}>{signed(l.net)}</td>
                <td onClick={e => e.stopPropagation()}>
                  <NoteField line={l.line_id} project={project} value={l.note}
                             onSaved={v => setLines(ls => ls.map(x =>
                               x.line_id === l.line_id ? { ...x, note: v } : x))} />
                </td>
              </tr>,
              isOpen && (
                <tr key={l.line_id + '-d'} className="expand">
                  <td colSpan={cols}>
                    <LineDetail line={l} onRecoded={() => { load(); onChanged && onChanged() }} />
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
    </>
  )
}

/** One-line note, saved when you leave the box or press Enter. Esc puts it back. */
function NoteField({ line, project, value, onSaved }) {
  const [text, setText] = useState(value || '')
  const [state, setState] = useState('')   // '', 'saving', 'saved', or an error

  useEffect(() => { setText(value || '') }, [value])

  async function save() {
    if ((text || '').trim() === (value || '').trim()) return
    setState('saving')
    try {
      const r = await rpc('set_project_line_note', { p_line: line, p_project: project, p_note: text })
      onSaved(r || null)
      setState('saved')
      setTimeout(() => setState(s => (s === 'saved' ? '' : s)), 1500)
    } catch (e) { setState(e.message) }
  }

  const bad = state && !['saving', 'saved'].includes(state)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input value={text} placeholder="add a note…" title={bad ? state : text}
             style={{ width: '100%', fontSize: 12, padding: '2px 6px',
                      borderColor: bad ? '#fca5a5' : undefined }}
             onChange={e => { setText(e.target.value); if (bad) setState('') }}
             onBlur={save}
             onKeyDown={e => {
               if (e.key === 'Enter') e.currentTarget.blur()
               if (e.key === 'Escape') { setText(value || ''); setState('') }
             }} />
      {state === 'saving' && <span className="muted" style={{ fontSize: 11 }}>…</span>}
      {state === 'saved' && <span className="muted" style={{ fontSize: 11, color: '#047857' }}>✓</span>}
      {bad && <span className="muted" style={{ fontSize: 11, color: '#b91c1c' }} title={state}>!</span>}
    </div>
  )
}

/**
 * The entry a line belongs to — every line of it, and its paperwork — and,
 * when the line came from a bank transaction, that transaction's coding
 * editor, the same one the review queues open.
 */
function LineDetail({ line, onRecoded }) {
  const [coding, setCoding] = useState(false)
  const [row, setRow] = useState(null)
  const [err, setErr] = useState('')

  async function openCoding() {
    if (coding) { setCoding(false); setRow(null); return }
    setCoding(true); setRow(null); setErr('')
    try {
      const r = await rpc('web_txn_row', { p_txn: line.transaction_id })
      if (!r.length) { setErr('That line has no transaction behind it.'); setCoding(false); return }
      setRow(r[0])
    } catch (e) { setErr(e.message); setCoding(false) }
  }

  return (
    <div>
      {line.ledger_entry_id
        ? <EntryDetail id={line.ledger_entry_id} />
        : <div className="muted">This line has no numbered entry to open.</div>}

      {line.transaction_id && (
        <div className="bar" style={{ margin: '8px 0 0' }}>
          <button onClick={openCoding}>
            {coding ? 'Close coding' : `Open coding for ${line.ref || 'this transaction'}`}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            Saving there rebuilds the entry. Notes follow the line as long as its entity and account stay the same.
          </span>
        </div>
      )}
      {err && <div className="err">{err}</div>}
      {coding && !row && <div className="loading">Reading…</div>}
      {coding && row && (
        <div style={{ marginTop: 8 }}>
          <TxnEditor txn={row} kind="plain" onDone={() => { setCoding(false); setRow(null); onRecoded() }} />
        </div>
      )}
    </div>
  )
}
