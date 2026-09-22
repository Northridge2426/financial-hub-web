import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'

/** The lines behind one GL account, over a period. Shared by every report that
 *  lets you click a figure to ask "what is this made of?". */
export default function DrillLines({ gl, from, to, includeOpening }) {
  const [lines, setLines] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setLines(null); setErr('')
    rpc('report_drilldown', {
      p_gl_account_id: gl, p_from: from, p_to: to, p_include_opening: !!includeOpening,
    }).then(setLines).catch(e => setErr(e.message))
  }, [gl, from, to, includeOpening])

  if (err) return <div className="err">{err}</div>
  if (!lines) return <div className="loading">Reading the entries…</div>
  if (!lines.length) return <div className="muted">No entries in this period.</div>

  return (
    <>
      <b style={{ fontSize: 12.5 }}>{lines.length} line{lines.length === 1 ? '' : 's'}</b>
      <table style={{ marginTop: 3 }}>
        <thead>
          <tr>
            <th style={{ width: '10%' }}>Date</th>
            <th style={{ width: '9%' }}>Entry</th>
            <th style={{ width: '9%' }}>Txn</th>
            <th>Description</th>
            <th className="num" style={{ width: '12%' }}>Debit</th>
            <th className="num" style={{ width: '12%' }}>Credit</th>
            <th className="num" style={{ width: '12%' }}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(x => (
            <tr key={x.line_id}>
              <td>{x.entry_date}</td>
              <td className="muted">{x.entry_no || ''}</td>
              <td className="muted">{x.txn_ref || ''}</td>
              <td>
                {x.description || ''}
                {x.is_opening && <span className="pill hold">opening</span>}
                {Number(x.docs) > 0 &&
                  <span className="pill soft">{x.docs} doc{Number(x.docs) === 1 ? '' : 's'}</span>}
              </td>
              <td className="money">{Number(x.debit) ? money(x.debit) : ''}</td>
              <td className="money">{Number(x.credit) ? money(x.credit) : ''}</td>
              <td className="money">{money(x.running)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
