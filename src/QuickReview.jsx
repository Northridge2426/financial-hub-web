import { useCallback, useEffect, useMemo, useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'

const num = v => Number(v) || 0

/**
 * Quick review — everything a rule already recognises, waiting to be posted.
 *
 * The coding is a property of the RULE, not the row: every Bell bill hits the
 * same accounts and only the amount moves. So the full coding is stated once on
 * the group banner — entity, number and name on both sides — rather than
 * repeated as bare numbers on a hundred rows.
 *
 * `quick_post` takes the ids you ticked and posts them. It is the one genuinely
 * bulk write in the app, so nothing is pre-ticked and the button stays disabled
 * until you choose something.
 */
export default function QuickReview() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [rule, setRule] = useState('')
  const [biz, setBiz] = useState('')
  const [stmtOnly, setStmtOnly] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  const [posting, setPosting] = useState(false)
  const [result, setResult] = useState(null)
  const [coding, setCoding] = useState(null)
  const [codingRows, setCodingRows] = useState(null)

  const load = useCallback(async () => {
    setErr('')
    try { setRows(await rpc('web_quick_review')) }
    catch (e) { setErr(e.message) }
  }, [])

  useEffect(() => { setRows(null); load() }, [load])

  // The filter lists come from EVERYTHING available, not the filtered set —
  // choosing one rule must not hide the others.
  const allRules = useMemo(
    () => [...new Set((rows || []).map(r => r.rule_name))].sort(), [rows])
  const allBiz = useMemo(
    () => [...new Set((rows || []).map(r => r.business))].sort(), [rows])

  const shown = useMemo(() => (rows || []).filter(r =>
    (!rule || r.rule_name === rule) &&
    (!biz || r.business === biz) &&
    (!stmtOnly || r.has_statement)), [rows, rule, biz, stmtOnly])

  const groups = useMemo(() => {
    const G = []
    for (const r of shown) {
      let g = G.find(x => x.rule === r.rule_name)
      if (!g) { G.push(g = { rule: r.rule_name, head: r, rows: [] }) }
      g.rows.push(r)
    }
    return G
  }, [shown])

  const toggle = id => setPicked(p => {
    const n = new Set(p)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const tickGroup = g => setPicked(p => {
    const n = new Set(p)
    const every = g.rows.every(r => n.has(r.id))
    g.rows.forEach(r => every ? n.delete(r.id) : n.add(r.id))
    return n
  })

  async function showCoding(g) {
    if (coding === g.rule) { setCoding(null); return }
    setCoding(g.rule); setCodingRows(null)
    try { setCodingRows(await rpc('quick_review_detail', { p_id: g.head.id })) }
    catch (e) { setCodingRows([{ biz: '', acct: e.message, gl_number: '', debit: 0, credit: 0 }]) }
  }

  async function post() {
    setPosting(true); setErr(''); setResult(null)
    try {
      const out = await rpc('quick_post', { p_ids: [...picked] })
      setResult(out)
      setPicked(new Set())
      setRows(null); await load()
    } catch (e) { setErr(e.message) }
    setPosting(false)
  }

  if (err && !rows) return <div className="page"><div className="err">{err}</div></div>
  if (!rows) return <div className="page"><div className="loading">Loading…</div></div>

  const total = shown.reduce((a, r) => a + num(r.amount), 0)
  const withStmt = shown.filter(r => r.has_statement).length

  return (
    <div className="page">
      {err && <div className="err">{err}</div>}

      {result && (
        <div className="note good">
          <b>Posted {result.length}.</b>
          <table style={{ marginTop: 6 }}>
            <tbody>
              {result.map((r, i) => (
                <tr key={i}>
                  <td style={{ width: 90 }} className="muted">{r.ref}</td>
                  <td>{r.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bar">
        <select value={rule} onChange={e => setRule(e.target.value)} style={{ maxWidth: 280 }}>
          <option value="">All rules</option>
          {allRules.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">All businesses</option>
          {allBiz.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={stmtOnly} style={{ width: 'auto' }}
                 onChange={e => setStmtOnly(e.target.checked)} />
          Statement linked only
        </label>
      </div>

      {shown.length === 0 ? (
        <div className="card">
          <div className="muted">
            Nothing waiting that a rule recognises. Anything dated 2025 is excluded — that year is
            closed and carried by its trial balances, so it could never be posted.
          </div>
        </div>
      ) : (
        <>
          <div className="grid" style={{ marginBottom: 14 }}>
            <div className="stat"><div className="n">{shown.length}</div><div className="l">ready to post</div></div>
            <div className="stat"><div className="n">${money(total)}</div><div className="l">total</div></div>
            <div className="stat"><div className="n">{withStmt}</div><div className="l">statement linked</div></div>
            <div className="stat">
              <div className={'n ' + (picked.size ? 'pos' : '')}>{picked.size}</div>
              <div className="l">ticked</div>
            </div>
          </div>

          <div className="bar">
            <button onClick={() => setPicked(new Set(shown.map(r => r.id)))}>Tick all shown</button>
            <button onClick={() => setPicked(new Set())}>Clear</button>
            <span style={{ flex: 1 }} />
            <button className="primary" disabled={!picked.size || posting} onClick={post}>
              {posting ? 'Posting…' : `Post and mark reviewed (${picked.size})`}
            </button>
          </div>

          {groups.map(g => {
            const gt = g.rows.reduce((a, r) => a + num(r.amount), 0)
            const h = g.head
            return (
              <div className="card" key={g.rule}>
                <div className="rulehead">
                  <div>
                    <b>{g.rule}</b>{' '}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      — {g.rows.length} item{g.rows.length === 1 ? '' : 's'}, ${money(gt)}
                    </span>
                    <button style={{ marginLeft: 8 }} onClick={() => tickGroup(g)}>Tick these</button>
                    <button style={{ marginLeft: 4 }} onClick={() => showCoding(g)}
                            title="Show the full coding for this rule — every entity and account it posts to.">
                      coding
                    </button>
                  </div>

                  <div style={{ marginTop: 3, fontSize: 12 }}>
                    <span className="pill">Dr</span>{' '}
                    <b>{h.dr_biz}{h.dr_number ? ' ' + h.dr_number : ''}</b> {h.dr_name}
                    &nbsp;&nbsp;
                    <span className="pill soft">Cr</span>{' '}
                    <b>{h.cr_biz}{h.cr_number ? ' ' + h.cr_number : ''}</b> {h.cr_name}
                    {h.project && (
                      <span className="pill hold" title="Tagged to this project">project {h.project}</span>
                    )}
                    {h.cross_entity && (
                      <span className="pill hold"
                            title="The card belongs to another entity, so the entry also records what is owed and what is recoverable — four lines, two ledgers.">
                        across entities
                      </span>
                    )}
                  </div>

                  {h.dr2_number && (
                    <div style={{ marginTop: 2, fontSize: 12 }}>
                      <span className="pill">Dr</span> <b>{h.dr2_biz} {h.dr2_number}</b> {h.dr2_name}
                      &nbsp;&nbsp;
                      <span className="pill soft">Cr</span> <b>{h.cr2_biz} {h.cr2_number}</b> {h.cr2_name}
                      <span className="muted" style={{ marginLeft: 6 }}>
                        the related-party legs — what one entity owes the other
                      </span>
                    </div>
                  )}

                  {h.memo && <div className="muted" style={{ marginTop: 2, fontSize: 12 }}>{h.memo}</div>}

                  {coding === g.rule && (
                    <div style={{ marginTop: 6 }}>
                      {!codingRows && <div className="loading">Reading the coding…</div>}
                      {codingRows && (
                        <table>
                          <tbody>
                            {codingRows.map((c, i) => (
                              <tr key={i}>
                                <td style={{ width: 60 }}><span className="pill">{c.biz}</span></td>
                                <td style={{ width: 90 }} className="muted">{c.gl_number}</td>
                                <td>{c.acct}{c.memo && <span className="muted"> · {c.memo}</span>}</td>
                                <td className="money" style={{ width: 110 }}>
                                  {num(c.debit) ? money(c.debit) : ''}
                                </td>
                                <td className="money" style={{ width: 110 }}>
                                  {num(c.credit) ? money(c.credit) : ''}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>

                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 28 }} />
                      <th style={{ width: 92 }}>Date</th>
                      <th style={{ width: 84 }}>Ref</th>
                      <th>Descriptor</th>
                      <th className="num" style={{ width: 104 }}>Debit</th>
                      <th className="num" style={{ width: 104 }}>Credit</th>
                      <th style={{ width: 120 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map(r => (
                      <tr key={r.id} className={picked.has(r.id) ? 'rowsel' : ''}>
                        <td>
                          <input type="checkbox" checked={picked.has(r.id)}
                                 onChange={() => toggle(r.id)} />
                        </td>
                        <td>{r.txn_date}</td>
                        <td className="muted">{r.ref}</td>
                        <td>
                          {r.descr}
                          {r.transfer_risk && (
                            <div className="due-soon" style={{ fontSize: 11.5 }}>
                              Possible transfer, not income — same amount the other way on {r.transfer_risk}
                            </div>
                          )}
                        </td>
                        <td className="money">
                          ${money(r.amount)}
                          <div className="muted" style={{ fontSize: 10.5 }}>{r.dr_number}</div>
                        </td>
                        <td className="money">
                          ${money(r.amount)}
                          <div className="muted" style={{ fontSize: 10.5 }}>{r.cr_number}</div>
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {num(r.docs) > 0 && <span className="pill soft">doc</span>}
                          {r.has_statement && <span className="pill">stmt</span>}
                          {r.transfer_risk && (
                            <span className="pill hold"
                                  title="A matching amount moves the other way on another account within five days. Tick it deliberately if it really is income.">
                              transfer?
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
