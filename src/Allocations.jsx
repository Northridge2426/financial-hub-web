import { useCallback, useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { useEntities } from './useEntities.js'

const num = v => Number(v) || 0

/**
 * Saved allocations — the splits used again and again.
 *
 * A profile says only "this cost is shared between these entities in these
 * proportions". Fixing an account on it is optional and usually wrong: the
 * vehicle profile is fuel most of the time and maintenance some of the time,
 * so leaving the account open means picking it each time rather than
 * correcting a wrong guess each time.
 *
 * `save_allocation_profile` refuses a code that already exists rather than
 * overwriting it. That is deliberate — entries already posted under a profile
 * were posted under the proportions it had then, and silently changing them
 * would make the history unexplainable. To change one, save a new code.
 */
export default function Allocations() {
  const [profiles, setProfiles] = useState(null)
  const [lines, setLines] = useState({})
  const [accounts, setAccounts] = useState([])
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [glNumber, setGlNumber] = useState('')
  const [parts, setParts] = useState([{ business: '', percent: 50 }, { business: '', percent: 50 }])
  const entities = useEntities()

  const load = useCallback(async () => {
    setErr('')
    const { data, error } = await supabase.from('allocation_profiles')
      .select('id,code,name,effective_from,detail').order('name')
    if (error) { setErr(error.message); return }
    setProfiles(data || [])

    const { data: pl } = await supabase.from('allocation_profile_lines')
      .select('profile_id,percent,businesses(code),gl_accounts(number,name)')
    const m = {}
    for (const l of pl || []) (m[l.profile_id] ||= []).push(l)
    setLines(m)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    supabase.from('v_chart_of_accounts').select('business,number,name')
      .eq('usable', true).eq('postable', true).order('number')
      .then(({ data }) => setAccounts(data || []))
  }, [])

  const total = parts.reduce((a, p) => a + num(p.percent), 0)
  const ready = code.trim() && name.trim() && Math.abs(total - 100) < 0.011 &&
                parts.filter(p => p.business && num(p.percent) > 0).length >= 1

  async function save() {
    setBusy(true); setErr(''); setMsg('')
    try {
      const res = await rpc('save_allocation_profile', {
        p_code: code.trim(),
        p_name: name.trim(),
        p_parts: parts.filter(p => p.business && num(p.percent) > 0)
                      .map(p => ({ business: p.business, percent: num(p.percent) })),
        p_gl_number: glNumber || null,
      })
      setMsg(typeof res === 'string' ? res : 'Saved.')
      setCode(''); setName(''); setGlNumber('')
      setParts([{ business: '', percent: 50 }, { business: '', percent: 50 }])
      await load()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  // The same number can exist in several charts; one entry per number is enough
  // for a profile, which names the account by number in every entity it touches.
  const accountNumbers = [...new Map(accounts.map(a => [a.number, a])).values()]

  return (
    <div className="page">
      <p className="hint">
        A saved allocation is a split used again and again — household costs across two
        businesses, a vehicle between three. It says only <b>who shares it and in what
        proportion</b>. Fixing an account on it is optional, and usually better left open:
        the vehicle profile is fuel most of the time and maintenance the rest.
      </p>

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      <div className="card">
        <h2>A new saved allocation</h2>
        <div className="bar" style={{ margin: 0 }}>
          <input value={code} placeholder="Short code" style={{ width: 150 }}
                 onChange={e => setCode(e.target.value)} />
          <input value={name} placeholder="What it is for" style={{ flex: 1, minWidth: 220 }}
                 onChange={e => setName(e.target.value)} />
          <label htmlFor="alGl">Account</label>
          <select id="alGl" value={glNumber} onChange={e => setGlNumber(e.target.value)}
                  style={{ maxWidth: 280 }}>
            <option value="">— pick one each time (recommended) —</option>
            {accountNumbers.map(a => (
              <option key={a.number} value={a.number}>{a.number} — {a.name}</option>
            ))}
          </select>
        </div>

        <table style={{ marginTop: 8 }}>
          <tbody>
            {parts.map((p, i) => (
              <tr key={i}>
                <td style={{ width: 160 }}>
                  <select value={p.business}
                          onChange={e => setParts(ps => ps.map((x, j) => j === i ? { ...x, business: e.target.value } : x))}>
                    <option value="">Entity…</option>
                    {entities.map(b => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
                  </select>
                </td>
                <td style={{ width: 140 }}>
                  <input type="number" step="0.01" className="num" value={p.percent}
                         onChange={e => setParts(ps => ps.map((x, j) => j === i ? { ...x, percent: e.target.value } : x))} />
                </td>
                <td className="muted">%</td>
                <td>
                  {parts.length > 1 && (
                    <button onClick={() => setParts(ps => ps.filter((_, j) => j !== i))}>×</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="bar" style={{ margin: '8px 0 0' }}>
          <button onClick={() => setParts(ps => [...ps, { business: '', percent: 0 }])}>
            Add an entity
          </button>
          <span className={Math.abs(total - 100) < 0.011 ? 'pos' : 'neg'} style={{ fontSize: 12 }}>
            {total.toFixed(2)}%
          </span>
          <span style={{ flex: 1 }} />
          <button className="primary" disabled={!ready || busy} onClick={save}>
            {busy ? 'Saving…' : 'Save it'}
          </button>
        </div>
        <p className="hint" style={{ margin: '6px 0 0' }}>
          A code that already exists is refused rather than overwritten. Entries posted under a
          profile were posted under the proportions it had at the time, and changing those
          underneath them would make the history unexplainable — so to change one, save a new code.
        </p>
      </div>

      {!profiles && <div className="loading">Reading…</div>}

      {profiles && (
        <div className="card">
          <h2>Saved allocations ({profiles.length})</h2>
          <table>
            <thead>
              <tr>
                <th style={{ width: 140 }}>Code</th>
                <th>Name</th>
                <th style={{ width: 110 }}>From</th>
                <th>Split</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => [
                <tr key={p.id} className="drill" onClick={() => setOpen(open === p.id ? null : p.id)}>
                  <td className="muted">{p.code}</td>
                  <td>{p.name}</td>
                  <td className="muted">{p.effective_from}</td>
                  <td style={{ fontSize: 11 }}>
                    {(lines[p.id] || []).map((l, i) => (
                      <span key={i} className="pill">
                        {l.businesses?.code} {num(l.percent).toFixed(0)}%
                      </span>
                    ))}
                  </td>
                </tr>,
                open === p.id && (
                  <tr key={p.id + '-d'} className="expand">
                    <td colSpan={4}>
                      {p.detail && <div className="muted" style={{ fontSize: 12 }}>{p.detail}</div>}
                      <table style={{ marginTop: 4 }}>
                        <tbody>
                          {(lines[p.id] || []).map((l, i) => (
                            <tr key={i}>
                              <td style={{ width: 90 }}>
                                <span className="pill">{l.businesses?.code}</span>
                              </td>
                              <td className="money" style={{ width: 90 }}>
                                {num(l.percent).toFixed(2)}%
                              </td>
                              <td className="muted">
                                {l.gl_accounts
                                  ? `${l.gl_accounts.number} — ${l.gl_accounts.name}`
                                  : 'no account fixed — picked each time'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
