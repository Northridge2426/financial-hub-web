import { useEffect, useMemo, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { useEntities } from './useEntities.js'

/**
 * Chart of accounts. Reads `v_chart_of_accounts`, which carries not just the
 * account but the evidence about it: whether it has been posted to here, seen
 * in a Sage trial balance, or used by an allocation profile or a role.
 *
 * "Usable" is a decision someone made; the four evidence flags are facts. An
 * account marked unusable that is nevertheless in use is the thing worth
 * spotting, so it gets its own filter.
 *
 * The page writes as well as reads. What it does NOT do is delete: an account
 * with history cannot be removed without rewriting that history, so the only
 * way out is to mark it not usable, which keeps the entries and stops new ones.
 */
export default function Accounts() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [biz, setBiz] = useState('')
  const [q, setQ] = useState('')
  const [view, setView] = useState('usable')
  const entities = useEntities()
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [renaming, setRenaming] = useState(null)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ business: '', number: '', name: '', type: 'expense', notes: '' })

  const load = () =>
    supabase.from('v_chart_of_accounts')
      .select('id,business,number,name,account_type,usable,postable,seen_in_tb,active_in_sage,usable_reason,sage_class,notes,posted_here,in_sage_journal,used_by_allocations,used_by_roles,is_a_bank_account')
      .order('business').order('number')
      .then(({ data, error }) => error ? setErr(error.message) : setRows(data || []))

  useEffect(() => { load() }, [])

  async function act(key, fn, done) {
    setBusy(key); setErr(''); setMsg('')
    try {
      const res = await fn()
      setMsg(typeof res === 'string' ? res : (done || 'Saved.'))
      await load()
      return true
    } catch (e) { setErr(e.message); return false }
    finally { setBusy('') }
  }

  // set_account_usable has TWO overloads — (p_id,…) and (p_business,p_number,…).
  // PostgREST resolves by argument NAME, so the uuid form is named explicitly
  // rather than left to chance.
  const setUsable = r => act(r.id, () => rpc('set_account_usable', {
    p_id: r.id,
    p_usable: !r.usable,
    p_reason: r.usable ? 'Marked not usable from the web console.'
                       : 'Marked usable from the web console.',
  }))

  // These four are COUNTS in the view, not booleans — and in JSX `0 && <span/>`
  // renders a literal "0". Coerce before using them as conditions.
  const n = v => Number(v) > 0
  const inUse = r =>
    n(r.posted_here) || n(r.in_sage_journal) || n(r.used_by_allocations) || n(r.used_by_roles)

  const shown = useMemo(() => {
    if (!rows) return []
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (biz && r.business !== biz) return false
      if (view === 'usable' && !r.usable) return false
      if (view === 'unusable' && r.usable) return false
      if (view === 'conflict' && !(!r.usable && inUse(r))) return false
      if (view === 'unused' && inUse(r)) return false
      if (!needle) return true
      return `${r.number} ${r.name} ${r.account_type} ${r.sage_class || ''}`.toLowerCase().includes(needle)
    })
  }, [rows, biz, q, view])

  if (err && !rows) return <div className="page"><div className="err">{err}</div></div>
  if (!rows) return <div className="page"><div className="loading">Reading…</div></div>

  const conflicts = rows.filter(r => !r.usable && inUse(r))

  return (
    <div className="page">
      <p className="hint">
        Every account across the six sets of books. <b>Usable</b> is a decision; the flags on the
        right are evidence. An account marked unusable that something is still using is worth a
        second look.
      </p>

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      <div className="bar">
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">All entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        <select value={view} onChange={e => setView(e.target.value)}>
          <option value="usable">Usable only</option>
          <option value="all">Everything</option>
          <option value="unusable">Not usable</option>
          <option value="conflict">Not usable, but in use ({conflicts.length})</option>
          <option value="unused">Never used</option>
        </select>
        <input type="search" placeholder="Number, name or class…" value={q}
               onChange={e => setQ(e.target.value)} style={{ width: 240 }} />
        <span className="muted" style={{ fontSize: 12 }}>{shown.length} of {rows.length}</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => { setAdding(a => !a); setDraft(d => ({ ...d, business: biz || d.business })) }}>
          {adding ? 'Cancel' : 'New account'}
        </button>
      </div>

      {adding && (
        <div className="card">
          <h2>A new account</h2>
          <div className="bar" style={{ margin: 0 }}>
            <select value={draft.business} onChange={e => setDraft({ ...draft, business: e.target.value })}>
              <option value="">Entity…</option>
              {entities.map(b => <option key={b.code} value={b.code}>{b.code}</option>)}
            </select>
            <input value={draft.number} placeholder="Number" style={{ width: 110 }}
                   onChange={e => setDraft({ ...draft, number: e.target.value })} />
            <input value={draft.name} placeholder="Name" style={{ flex: 1, minWidth: 220 }}
                   onChange={e => setDraft({ ...draft, name: e.target.value })} />
            <select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}>
              <option value="expense">expense</option>
              <option value="revenue">revenue</option>
              <option value="asset">asset</option>
              <option value="liability">liability</option>
              <option value="equity">equity</option>
            </select>
            <button className="primary"
                    disabled={!draft.business || !draft.number.trim() || !draft.name.trim() || !!busy}
                    onClick={async () => {
                      const ok = await act('new', () => rpc('create_gl_account', {
                        p_business: draft.business, p_number: draft.number.trim(),
                        p_name: draft.name.trim(), p_type: draft.type,
                        p_notes: draft.notes.trim() || null,
                      }), 'Account created.')
                      if (ok) { setAdding(false); setDraft({ business: '', number: '', name: '', type: 'expense', notes: '' }) }
                    }}>
              {busy === 'new' ? 'Creating…' : 'Create it'}
            </button>
          </div>
          <input value={draft.notes} placeholder="A note, if the name does not say enough"
                 style={{ marginTop: 6 }}
                 onChange={e => setDraft({ ...draft, notes: e.target.value })} />
          <p className="hint" style={{ margin: '6px 0 0' }}>
            If the number is already taken, the function says so and names the first free one at or
            above it — it will not quietly write over an account that has entries behind it.
          </p>
        </div>
      )}

      {conflicts.length > 0 && view !== 'conflict' && (
        <div className="note warn">
          <b>{conflicts.length} account{conflicts.length === 1 ? ' is' : 's are'} marked not usable
          but still in use</b> — posted here, in a Sage journal, or named by an allocation profile
          or role. Switch the filter to see them.
        </div>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th style={{ width: 66 }}>Entity</th>
              <th style={{ width: 80 }}>Number</th>
              <th>Name</th>
              <th style={{ width: 130 }}>Type</th>
              <th style={{ width: 140 }}>Sage class</th>
              <th style={{ width: 200 }}>Evidence</th>
              <th style={{ width: 80 }}>Usable</th>
              <th style={{ width: 150 }} />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={8} className="muted">Nothing matches those filters.</td></tr>
            )}
            {shown.map(r => [
              <tr key={r.id}>
                <td><span className="pill">{r.business}</span></td>
                <td className="muted">{r.number}</td>
                <td>
                  {r.name}
                  {n(r.is_a_bank_account) && <span className="pill soft">bank</span>}
                  {r.notes && <div className="muted" style={{ fontSize: 11 }}>{r.notes}</div>}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{r.account_type}</td>
                <td className="muted" style={{ fontSize: 12 }}>{r.sage_class || ''}</td>
                <td style={{ fontSize: 11 }}>
                  {n(r.posted_here) && <span className="pill soft">posted here</span>}
                  {n(r.in_sage_journal) && <span className="pill soft">Sage</span>}
                  {n(r.used_by_allocations) && <span className="pill hold">allocation</span>}
                  {n(r.used_by_roles) && <span className="pill hold">role</span>}
                  {r.seen_in_tb && <span className="pill">in TB</span>}
                  {!inUse(r) && !r.seen_in_tb && <span className="muted">—</span>}
                </td>
                <td>
                  {r.usable
                    ? <span className="pos">yes</span>
                    : <span className="neg" title={r.usable_reason || ''}>no</span>}
                </td>
                <td style={{ fontSize: 11 }}>
                  <button disabled={busy === r.id} style={{ padding: '1px 8px', fontSize: 11 }}
                          onClick={() => { setRenaming(renaming === r.id ? null : r.id); setNewName(r.name) }}>
                    {renaming === r.id ? 'cancel' : 'rename'}
                  </button>{' '}
                  {r.usable ? (
                    <button disabled={busy === r.id} style={{ padding: '1px 8px', fontSize: 11 }}
                            title={inUse(r)
                              ? 'Something is still using this account. It will stop new postings, not remove the old ones.'
                              : 'Stops new postings. Nothing already posted changes.'}
                            onClick={() => setUsable(r)}>
                      retire
                    </button>
                  ) : (
                    <button disabled={busy === r.id} style={{ padding: '1px 8px', fontSize: 11 }}
                            onClick={() => r.postable
                              ? act(r.id, () => rpc('activate_gl_account',
                                  { p_business: r.business, p_number: r.number }))
                              : setUsable(r)}>
                      activate
                    </button>
                  )}
                </td>
              </tr>,
              renaming === r.id && (
                <tr key={r.id + '-n'} className="expand">
                  <td colSpan={8}>
                    <div className="bar" style={{ margin: 0 }}>
                      <span style={{ fontSize: 12.5 }}>Rename {r.business} {r.number}</span>
                      <input value={newName} onChange={e => setNewName(e.target.value)}
                             style={{ flex: 1, minWidth: 260 }}
                             onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) {
                               act(r.id, () => rpc('rename_gl_account', { p_id: r.id, p_name: newName.trim() }))
                                 .then(ok => ok && setRenaming(null))
                             } }} />
                      <button className="primary" disabled={!newName.trim() || busy === r.id}
                              onClick={() => act(r.id,
                                () => rpc('rename_gl_account', { p_id: r.id, p_name: newName.trim() }))
                                .then(ok => ok && setRenaming(null))}>
                        {busy === r.id ? 'Saving…' : 'Rename it'}
                      </button>
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        The number is the identity and does not change — only what it is called.
                      </span>
                    </div>
                  </td>
                </tr>
              ),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  )
}
