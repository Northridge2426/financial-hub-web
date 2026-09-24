import { useCallback, useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money, today } from './format.js'
import { useEntities } from './useEntities.js'

const num = v => Number(v) || 0
const blank = () => ({ business: '', account: '', debit: '', credit: '', memo: '' })

/**
 * Manual journal entries — the list, and a form to record a new one.
 *
 * Balance is checked PER BUSINESS, not across the whole entry: two entities in
 * one entry must each balance on their own, or the books stop being six sets of
 * books. The Post button stays disabled until that holds.
 */
export default function JournalEntry() {
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState(null)
  const [killing, setKilling] = useState(null)   // jno awaiting a reason
  const [killWhy, setKillWhy] = useState('')
  const [removing, setRemoving] = useState(false)
  const [tagging, setTagging] = useState(null)        // jno awaiting projects
  const [tagBiz, setTagBiz] = useState('')
  const [tagAcct, setTagAcct] = useState('')
  const [tagProjects, setTagProjects] = useState([])
  const [projects, setProjects] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const [date, setDate] = useState(today())
  const [memo, setMemo] = useState('')
  const [reference, setReference] = useState('')
  const [lines, setLines] = useState([blank(), blank()])
  const [posting, setPosting] = useState(false)
  const [accounts, setAccounts] = useState([])
  const entities = useEntities()

  const load = useCallback(async () => {
    setErr('')
    try { setRows(await rpc('manual_journal_entries', { p_from: from, p_to: to })) }
    catch (e) { setErr(e.message) }
  }, [from, to])

  useEffect(() => { setRows(null); load() }, [load])

  useEffect(() => {
    supabase.from('v_chart_of_accounts')
      .select('business,number,name').eq('usable', true).eq('postable', true)
      .order('business').order('number')
      .then(({ data }) => setAccounts(data || []))
    supabase.from('projects').select('id,name').eq('active', true).order('name')
      .then(({ data }) => setProjects(data || []))
  }, [])

  const setLine = (i, k, v) =>
    setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l))

  // Per-business balance. An entry spanning two entities must balance in each.
  /**
   * Removing an entry raised here.
   *
   * The UI does not decide what may be removed — `delete_journal_entry` does,
   * and it refuses anything that is not origin HUB / source Manual, anything
   * in a closed year, and anything without a reason. That is the right place
   * for the rule, so this is only the way to reach it.
   */
  /**
   * Project tags on an entry already posted.
   *
   * Tags are not part of the entry — they are labels on its lines, and adding
   * one changes no figure and no account. That is why this is allowed on a
   * posted entry at all, where editing the entry itself is not.
   */
  async function tagEntry(jno) {
    setRemoving(true); setErr(''); setMsg('')
    try {
      const n = await rpc('tag_journal_entry_lines', {
        p_jno: jno, p_business: tagBiz, p_account: tagAcct, p_projects: tagProjects,
      })
      setMsg(`${n} line${Number(n) === 1 ? '' : 's'} tagged on ${jno}.`)
      setTagging(null); setTagProjects([])
      await load()
    } catch (e) { setErr(e.message) }
    setRemoving(false)
  }

  async function removeEntry(jno) {
    if (!killWhy.trim()) { setErr('Say why. A deleted entry with no reason is worse than a wrong one.'); return }
    setRemoving(true); setErr(''); setMsg('')
    try {
      const res = await rpc('delete_journal_entry', { p_jno: jno, p_reason: killWhy.trim() })
      setMsg(typeof res === 'string' ? res : jno + ' removed.')
      setKilling(null); setKillWhy('')
      await load()
    } catch (e) { setErr(e.message) }
    setRemoving(false)
  }

  const perBiz = {}
  for (const l of lines) {
    if (!l.business) continue
    const b = perBiz[l.business] || (perBiz[l.business] = { d: 0, c: 0 })
    b.d += num(l.debit); b.c += num(l.credit)
  }
  const offBy = Object.entries(perBiz)
    .map(([b, v]) => ({ business: b, diff: Math.round((v.d - v.c) * 100) / 100 }))
    .filter(x => x.diff !== 0)
  const filled = lines.filter(l => l.business && l.account && (num(l.debit) || num(l.credit)))
  const canPost = filled.length >= 2 && offBy.length === 0 && memo.trim() !== ''

  async function post() {
    setPosting(true); setErr(''); setMsg('')
    try {
      const payload = filled.map(l => ({
        business: l.business,
        account: l.account,
        debit: num(l.debit) || 0,
        credit: num(l.credit) || 0,
        memo: l.memo || null,
      }))
      const res = await rpc('record_journal_entry', {
        p_date: date,
        p_memo: memo.trim(),
        p_lines: payload,
        p_reference: reference.trim() || null,
      })
      setMsg(typeof res === 'string' ? res : 'Posted.')
      setLines([blank(), blank()]); setMemo(''); setReference('')
      setRows(null); await load()
    } catch (e) { setErr(e.message) }
    setPosting(false)
  }

  return (
    <div className="page">
      <div className="card">
        <h2>Record an entry</h2>

        <div className="bar" style={{ margin: '0 0 10px' }}>
          <label htmlFor="jeDate">Date</label>
          <input id="jeDate" type="date" value={date} onChange={e => setDate(e.target.value)} />
          <input placeholder="What is it for?" value={memo}
                 onChange={e => setMemo(e.target.value)} style={{ width: 320 }} />
          <input placeholder="Reference (optional)" value={reference}
                 onChange={e => setReference(e.target.value)} style={{ width: 180 }} />
        </div>

        <table>
          <thead>
            <tr>
              <th style={{ width: 120 }}>Entity</th>
              <th>Account</th>
              <th className="num" style={{ width: 130 }}>Debit</th>
              <th className="num" style={{ width: 130 }}>Credit</th>
              <th style={{ width: 200 }}>Memo</th>
              <th style={{ width: 40 }} />
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
                    {accounts.filter(a => a.business === l.business).map(a => (
                      <option key={a.business + a.number} value={a.number}>
                        {a.number} — {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input type="number" step="0.01" value={l.debit} className="num"
                         onChange={e => setLine(i, 'debit', e.target.value)}
                         disabled={num(l.credit) > 0} />
                </td>
                <td>
                  <input type="number" step="0.01" value={l.credit} className="num"
                         onChange={e => setLine(i, 'credit', e.target.value)}
                         disabled={num(l.debit) > 0} />
                </td>
                <td>
                  <input value={l.memo} onChange={e => setLine(i, 'memo', e.target.value)} />
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

        <div className="bar" style={{ margin: '10px 0 0' }}>
          <button onClick={() => setLines(ls => [...ls, blank()])}>Add a line</button>
          <span className="spacer" style={{ flex: 1 }} />
          {Object.entries(perBiz).map(([b, v]) => (
            <span key={b} className="muted" style={{ fontSize: 12 }}>
              {b}: {money(v.d)} / {money(v.c)}
            </span>
          ))}
          <button className="primary" disabled={!canPost || posting} onClick={post}>
            {posting ? 'Posting…' : 'Post entry'}
          </button>
        </div>

        {offBy.length > 0 && (
          <div className="note warn" style={{ marginTop: 10 }}>
            <b>Not balanced.</b>{' '}
            {offBy.map((x, i) => (
              <span key={x.business}>
                {i > 0 && ' · '}{x.business} is out by {money(Math.abs(x.diff))}{' '}
                ({x.diff > 0 ? 'debits exceed credits' : 'credits exceed debits'})
              </span>
            ))}
            <div className="fine">
              Each entity has to balance on its own — six sets of books, not one. An entry that
              only balances in total would quietly move money between entities.
            </div>
          </div>
        )}

        {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
        {msg && <div className="note good" style={{ marginTop: 10 }}>{msg}</div>}
      </div>

      <div className="bar">
        <label htmlFor="jeFrom">From</label>
        <input id="jeFrom" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label htmlFor="jeTo">To</label>
        <input id="jeTo" type="date" value={to} onChange={e => setTo(e.target.value)} />
      </div>

      {!rows && !err && <div className="loading">Reading…</div>}
      {rows && (
        <div className="card">
          <h2>Entries raised by hand</h2>
          {rows.length === 0 ? (
            <div className="muted">None in this window.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 110 }}>No.</th>
                  <th style={{ width: 96 }}>Date</th>
                  <th>Memo</th>
                  <th style={{ width: 120 }}>Reference</th>
                  <th style={{ width: 110 }}>Entities</th>
                  <th className="num" style={{ width: 60 }}>Lines</th>
                  <th className="num" style={{ width: 110 }}>Amount</th>
                  <th className="num" style={{ width: 60 }}>Docs</th>
                  <th style={{ width: 74 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => [
                  <tr key={r.jno}>
                    <td className="muted">{r.jno}</td>
                    <td>{r.entry_date}</td>
                    <td>{r.memo}</td>
                    <td className="muted">{r.reference || ''}</td>
                    <td style={{ fontSize: 11 }}>{r.entities}</td>
                    <td className="money">{r.lines}</td>
                    <td className="money">${money(r.amount)}</td>
                    <td className="money">
                      {num(r.docs) ? <span className="pill soft">{r.docs}</span> : <span className="muted">—</span>}
                    </td>
                    <td>
                      <button disabled={removing} style={{ padding: '1px 8px', fontSize: 11 }}
                              title="Put project tags on this entry's lines. Changes no figure."
                              onClick={() => { setTagging(tagging === r.jno ? null : r.jno); setTagProjects([]); setTagBiz(''); setTagAcct('') }}>
                        {tagging === r.jno ? 'cancel' : 'tag'}
                      </button>{' '}
                      <button disabled={removing} style={{ padding: '1px 8px', fontSize: 11 }}
                              onClick={() => { setKilling(killing === r.jno ? null : r.jno); setKillWhy('') }}>
                        {killing === r.jno ? 'cancel' : 'remove'}
                      </button>
                    </td>
                  </tr>,
                  tagging === r.jno && (
                    <tr key={r.jno + '-tag'} className="expand">
                      <td colSpan={9}>
                        <div className="bar" style={{ margin: 0 }}>
                          <span style={{ fontSize: 12.5 }}>On {r.jno}, tag the lines for</span>
                          <select value={tagBiz} onChange={e => { setTagBiz(e.target.value); setTagAcct('') }}>
                            <option value="">Entity…</option>
                            {entities.map(b => <option key={b.code} value={b.code}>{b.code}</option>)}
                          </select>
                          <select value={tagAcct} disabled={!tagBiz} style={{ minWidth: 280 }}
                                  onChange={e => setTagAcct(e.target.value)}>
                            <option value="">Account…</option>
                            {accounts.filter(a => a.business === tagBiz).map(a => (
                              <option key={a.number} value={a.number}>{a.number} — {a.name}</option>
                            ))}
                          </select>
                          <button className="primary"
                                  disabled={!tagBiz || !tagAcct || tagProjects.length === 0 || removing}
                                  onClick={() => tagEntry(r.jno)}>
                            {removing ? 'Tagging…' : 'Tag them'}
                          </button>
                        </div>
                        <div className="tickgrid" style={{ marginTop: 6 }}>
                          {projects.map(p => (
                            <label key={p.id} className="tick">
                              <input type="checkbox" checked={tagProjects.includes(p.id)}
                                     onChange={() => setTagProjects(t => t.includes(p.id)
                                       ? t.filter(x => x !== p.id) : [...t, p.id])} />
                              {p.name}
                            </label>
                          ))}
                        </div>
                        <p className="hint" style={{ margin: '4px 0 0' }}>
                          Tags are labels on the lines, not part of the entry — no figure and no
                          account changes, which is why this is allowed on something already posted.
                        </p>
                      </td>
                    </tr>
                  ),
                  killing === r.jno && (
                    <tr key={r.jno + '-kill'} className="expand">
                      <td colSpan={9}>
                        <div className="bar" style={{ margin: 0 }}>
                          <span style={{ fontSize: 12.5 }}>Why is {r.jno} being removed?</span>
                          <input value={killWhy} onChange={e => setKillWhy(e.target.value)}
                                 placeholder="The reason is returned with the confirmation — say it plainly"
                                 style={{ flex: 1, minWidth: 260 }}
                                 onKeyDown={e => { if (e.key === 'Enter') removeEntry(r.jno) }} />
                          <button disabled={!killWhy.trim() || removing}
                                  onClick={() => removeEntry(r.jno)}>
                            {removing ? 'Removing…' : `Remove ${r.jno} and its ${r.lines} lines`}
                          </button>
                        </div>
                        <p className="hint" style={{ margin: '4px 0 0' }}>
                          Only entries raised on this page can be removed, and not in a closed
                          year — the database enforces both. Any documents attached are detached,
                          not deleted.
                        </p>
                      </td>
                    </tr>
                  ),
                ])}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
