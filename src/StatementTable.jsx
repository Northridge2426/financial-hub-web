import { useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'

/**
 * The sectioned statement table shared by Balance sheet and Income statement,
 * with drill-through into the lines behind any account.
 *
 * A row with no `gl_account_id` — "Earnings this year", or an entity's net
 * income in the combined view — has nothing behind it, so it must not look
 * clickable. That distinction is the whole reason this isn't a plain table.
 */
export default function StatementTable({ rows, sections, showBiz, from, to, includeOpening }) {
  const [openGl, setOpenGl] = useState(null)
  const [lines, setLines] = useState(null)
  const [lineErr, setLineErr] = useState('')

  async function drill(gl) {
    if (openGl === gl) { setOpenGl(null); setLines(null); return }
    setOpenGl(gl); setLines(null); setLineErr('')
    try {
      setLines(await rpc('report_drilldown', {
        p_gl_account_id: gl,
        p_from: from,
        p_to: to,
        p_include_opening: !!includeOpening,
      }))
    } catch (e) { setLineErr(e.message) }
  }

  const span = showBiz ? 3 : 2
  const present = sections.filter(s => rows.some(r => r.section === s))
  if (!present.length) return <div className="card"><div className="muted">Nothing in this period.</div></div>

  return (
    <>
      {present.map(sec => (
        <div className="card" key={sec}>
          <table>
            <thead>
              <tr>
                <th colSpan={span}>{sec}</th>
                <th className="num" style={{ width: '18%' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter(r => r.section === sec).map((r, i) => {
                const v = Number(r.amount || 0)
                if (r.is_total) {
                  return (
                    <tr className="total" key={'t' + i}>
                      <td colSpan={span}>{r.name}</td>
                      <td className="money">{money(v)}</td>
                    </tr>
                  )
                }
                const gl = r.gl_account_id || ''
                const isOpen = gl && openGl === gl
                return [
                  <tr key={'r' + i} className={gl ? 'drill' : ''}
                      onClick={gl ? () => drill(gl) : undefined}>
                    {showBiz && <td className="muted" style={{ width: '7%' }}>{r.business || ''}</td>}
                    <td className="muted" style={{ width: '12%' }}>{r.number}</td>
                    <td>{r.name}</td>
                    <td className={'money ' + (v ? '' : 'muted')}>{money(v)}</td>
                  </tr>,
                  isOpen && (
                    <tr key={'x' + i} className="expand">
                      <td colSpan={span + 1}>
                        {lineErr && <div className="err">{lineErr}</div>}
                        {!lines && !lineErr && <div className="loading">Reading the entries…</div>}
                        {lines && lines.length === 0 && <div className="muted">No entries in this period.</div>}
                        {lines && lines.length > 0 && (
                          <>
                            <b style={{ fontSize: 12.5 }}>
                              {lines.length} line{lines.length === 1 ? '' : 's'}
                            </b>
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
                        )}
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      ))}
    </>
  )
}
