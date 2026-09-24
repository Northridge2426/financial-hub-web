import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money } from './format.js'
import { useEntities } from './useEntities.js'
import DocLink from './DocLink.jsx'

const num = v => Number(v) || 0

/**
 * Queue 8 — Statement only, review.
 *
 * These were cleared on the strength of the statement alone: no receipt, no
 * invoice, `review_basis = 'reference'`. The statement proves the money moved;
 * it does not say what it was for. So they are reviewed but uncoded, and this
 * is where the coding is put on.
 *
 * **The whole point is coding them in runs.** One statement of card charges is
 * forty lines of the same handful of vendors, and `code_statement_lines` takes
 * a whole selection at once — building the cross-entity legs itself, splitting
 * the GST out when asked, skipping anything already coded, and marking the rest
 * reviewed. Doing this a line at a time is what the pane exists to avoid.
 *
 * Grouped by "who" by default, because that is the unit the work comes in.
 */
export default function StatementReview() {
  const [rows, setRows] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [projects, setProjects] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  const [bucket, setBucket] = useState('')
  const [owner, setOwner] = useState('')
  const [q, setQ] = useState('')
  const [business, setBusiness] = useState('')
  const [account, setAccount] = useState('')
  const [withGst, setWithGst] = useState(false)
  const [tags, setTags] = useState([])
  const entities = useEntities()

  const load = useCallback(async () => {
    setErr(''); setRows(null); setPicked(new Set())
    const { data, error } = await supabase.from('v_statement_review')
      .select('id,ref,txn_date,amount,direction,account,owner,who,descr,support_status,status,review_basis,support_note,has_statement,stmt_path,candidate_docs,bucket')
      .order('txn_date')
    if (error) setErr(error.message); else setRows(data || [])
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    supabase.from('v_chart_of_accounts').select('business,number,name')
      .eq('usable', true).eq('postable', true).order('business').order('number')
      .then(({ data }) => setAccounts(data || []))
    supabase.from('projects').select('id,name').eq('active', true).order('name')
      .then(({ data }) => setProjects(data || []))
  }, [])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (rows || []).filter(r =>
      (!bucket || r.bucket === bucket) &&
      (!owner || r.owner === owner) &&
      (!needle || `${r.who} ${r.descr} ${r.ref}`.toLowerCase().includes(needle)))
  }, [rows, bucket, owner, q])

  // Grouped by who, because that is the unit the work comes in: one vendor's
  // run of charges is coded once, not line by line.
  const groups = useMemo(() => {
    const m = new Map()
    for (const r of shown) {
      let g = m.get(r.who)
      if (!g) { g = { who: r.who, rows: [], total: 0 }; m.set(r.who, g) }
      g.rows.push(r); g.total += num(r.amount)
    }
    return [...m.values()].sort((a, b) => b.rows.length - a.rows.length)
  }, [shown])

  const toggle = id => setPicked(p => {
    const n = new Set(p)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const pickGroup = g => setPicked(p => {
    const n = new Set(p)
    const all = g.rows.every(r => n.has(r.id))
    for (const r of g.rows) all ? n.delete(r.id) : n.add(r.id)
    return n
  })

  const pickedRows = shown.filter(r => picked.has(r.id))
  const pickedTotal = pickedRows.reduce((a, r) => a + num(r.amount), 0)
  const accountsFor = b => accounts.filter(a => a.business === b)

  async function code() {
    setBusy(true); setErr(''); setMsg('')
    try {
      const res = await rpc('code_statement_lines', {
        p_ids: [...picked],
        p_business: business,
        p_account: account,
        p_projects: tags.length ? tags : null,
        p_gst: withGst,
      })
      setMsg(typeof res === 'string' ? res : 'Coded.')
      setPicked(new Set()); setTags([])
      await load()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const owners = [...new Set((rows || []).map(r => r.owner))].sort()
  const buckets = [...new Set((rows || []).map(r => r.bucket))].sort()

  return (
    <div className="page">
      <p className="hint">
        Cleared on the statement alone — the money certainly moved, but nothing says what it was
        for, so they are reviewed and uncoded. Code them in <b>runs</b>: one vendor's charges go
        on in a single pass, cross-entity legs and all.
      </p>

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      <div className="bar">
        <select value={bucket} onChange={e => setBucket(e.target.value)}>
          <option value="">Every kind</option>
          {buckets.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={owner} onChange={e => setOwner(e.target.value)}>
          <option value="">Every entity</option>
          {owners.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <input type="search" placeholder="Vendor, descriptor or ref…" value={q}
               onChange={e => setQ(e.target.value)} style={{ width: 220 }} />
        {rows && (
          <span className="muted" style={{ fontSize: 12 }}>
            {shown.length} of {rows.length} · {groups.length} vendors
          </span>
        )}
      </div>

      {/* The coding bar stays at the top rather than under the list: what is
          being coded is the selection, and the selection is made below. */}
      {picked.size > 0 && (
        <div className="note">
          <b>{picked.size} line{picked.size === 1 ? '' : 's'} · ${money(pickedTotal)}</b>
          <div className="bar" style={{ margin: '6px 0 0', flexWrap: 'wrap' }}>
            <select value={business} onChange={e => { setBusiness(e.target.value); setAccount('') }}>
              <option value="">Entity…</option>
              {entities.map(b => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
            </select>
            <select value={account} disabled={!business} style={{ minWidth: 300 }}
                    onChange={e => setAccount(e.target.value)}>
              <option value="">Account…</option>
              {accountsFor(business).map(a => (
                <option key={a.number} value={a.number}>{a.number} — {a.name}</option>
              ))}
            </select>
            <label className="tick" title="Split the GST out of each amount using the entity's GST paid account.">
              <input type="checkbox" checked={withGst} onChange={e => setWithGst(e.target.checked)} />
              Split the GST out
            </label>
            <span style={{ flex: 1 }} />
            <button onClick={() => setPicked(new Set())}>Clear</button>
            <button className="primary" disabled={!business || !account || busy} onClick={code}>
              {busy ? 'Coding…' : `Code ${picked.size} line${picked.size === 1 ? '' : 's'}`}
            </button>
          </div>

          {projects.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Projects</span>
              <div className="tickgrid" style={{ marginTop: 2 }}>
                {projects.map(p => (
                  <label key={p.id} className="tick">
                    <input type="checkbox" checked={tags.includes(p.id)}
                           onChange={() => setTags(t => t.includes(p.id)
                             ? t.filter(x => x !== p.id) : [...t, p.id])} />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <p className="hint" style={{ margin: '6px 0 0' }}>
            The card's own account supplies the other side, and where the payer is not the entity
            being charged the related-party legs are written too. Anything in the selection that is
            already coded is skipped rather than doubled.
          </p>
        </div>
      )}

      {!rows && !err && <div className="loading">Reading…</div>}
      {rows && shown.length === 0 && (
        <div className="card"><div className="muted">Nothing matches.</div></div>
      )}

      {groups.map(g => (
        <div className="card" key={g.who}>
          <h2 className="clickable" onClick={() => pickGroup(g)}>
            {g.who}{' '}
            <span className="muted" style={{ fontWeight: 400 }}>
              {g.rows.length} line{g.rows.length === 1 ? '' : 's'} · ${money(g.total)}
            </span>
            {g.rows.every(r => picked.has(r.id)) && <span className="pill soft">all picked</span>}
          </h2>
          <table>
            <tbody>
              {g.rows.map(r => (
                <tr key={r.id}>
                  <td style={{ width: 28 }}>
                    <input type="checkbox" checked={picked.has(r.id)} style={{ width: 'auto' }}
                           onChange={() => toggle(r.id)} />
                  </td>
                  <td style={{ width: 84 }} className="muted">{r.ref}</td>
                  <td style={{ width: 92 }}>{r.txn_date}</td>
                  <td style={{ width: 56 }}><span className="pill">{r.owner}</span></td>
                  <td style={{ width: 140, fontSize: 12 }}>{r.account}</td>
                  <td>{r.descr}</td>
                  <td className={'money ' + (r.direction === 'inflow' ? 'pos' : '')}
                      style={{ width: 104 }}>
                    {r.direction === 'inflow' ? '+' : '−'}${money(r.amount)}
                  </td>
                  <td style={{ width: 150, fontSize: 11 }}>
                    {num(r.candidate_docs) > 0 && (
                      <span className="pill hold"
                            title="A document on file matches this amount and date. It may be the receipt this line was cleared without — see Document matching.">
                        {r.candidate_docs} doc?
                      </span>
                    )}
                    {r.stmt_path && <DocLink path={r.stmt_path} label="stmt" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {g.rows.some(r => r.support_note) && (
            <p className="hint" style={{ margin: '6px 0 0' }}>
              {[...new Set(g.rows.map(r => r.support_note).filter(Boolean))].join(' · ')}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
