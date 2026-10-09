import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { rpc, supabase } from './supabase.js'
import { money, today, shortDate } from './format.js'
import { useEntities } from './useEntities.js'

/**
 * Financial overview — every account, what it costs, what is due and when.
 *
 * A port of the console's overview (hub-live.html, runOverview), with search
 * and filters added. Balances for accounts this system tracks come from the
 * last statement moved forward by every transaction since; the rest are typed
 * and each typed entry keeps its own date.
 *
 * A position is LINKED (tracked) or it is not. `save_position_balances`
 * refuses to write over a tracked one and says so, so the inline inputs are
 * only drawn for typed positions.
 */

const num = v => Number(v) || 0
const isNum = v => v !== null && v !== undefined && v !== ''
const signed = v => (num(v) < 0 ? '−' : '') + '$' + money(Math.abs(num(v)))
const pct = v => (num(v) * 100).toFixed(2) + '%'
const NO_BALANCE = 'no balance recorded'

// Open on what needs attention: cards and lines of credit are where the
// interest and the due dates are. The rest is reference until asked for.
const OPEN_BY_DEFAULT = ['cards', 'credit']
const REVOLVING = ['cards', 'credit']

// Categorical series colours, assigned in this order and never cycled.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']

const tie = (a, b) => Math.abs(num(b.balance)) - Math.abs(num(a.balance)) || a.name.localeCompare(b.name)

// dir: 1 ascending, -1 descending — the natural first-click direction.
const SORTS = {
  default:   { label: 'Default order' },
  due:       { label: 'Due date',                    dir: 1,  get: r => r.due_date || null },
  rate:      { label: 'Cost — what to pay first',    dir: -1, get: r => isNum(r.effective_rate) ? num(r.effective_rate) : null },
  balance:   { label: 'Size',                        dir: -1, get: r => Math.abs(num(r.balance)) },
  name:      { label: 'Name',                        dir: 1,  get: r => r.name.toLowerCase() },
  used:      { label: 'Credit used',                 dir: -1, get: r => isNum(r.usage_pct) ? num(r.usage_pct) : null },
  available: { label: 'Available',                   dir: 1,  get: r => isNum(r.available) ? num(r.available) : null },
  limit:     { label: 'Limit',                       dir: -1, get: r => isNum(r.credit_limit) ? num(r.credit_limit) : null },
  min:       { label: 'Minimum due',                 dir: -1, get: r => isNum(r.min_due) ? num(r.min_due) : null },
  funding:   { label: 'Paid from',                   dir: 1,  get: r => (r.funding || '').toLowerCase() || null },
}

function comparator(key, dir) {
  const get = SORTS[key]?.get
  if (!get) return null
  return (a, b) => {
    const x = get(a), y = get(b)
    if (x == null && y == null) return tie(a, b)
    if (x == null) return 1            // blanks always last, whichever way
    if (y == null) return -1
    return (x < y ? -1 : x > y ? 1 : 0) * dir || tie(a, b)
  }
}

const daysBetween = (a, b) => {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

const shortMoney = v => {
  const a = Math.abs(v), s = v < 0 ? '−' : ''
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M'
  if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k'
  return s + '$' + a.toFixed(0)
}

function niceTicks(lo, hi, count = 5) {
  if (lo === hi) { lo -= 1; hi += 1 }
  const raw = (hi - lo) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw) || 10 * mag
  const ticks = []
  for (let t = Math.floor(lo / step) * step; t <= hi + step * 0.001; t += step) ticks.push(t)
  if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step)
  return ticks
}

const readShut = () => {
  try { const v = JSON.parse(localStorage.getItem('hub.ov.shut')); return Array.isArray(v) ? v : null }
  catch { return null }
}
const writeShut = s => { try { localStorage.setItem('hub.ov.shut', JSON.stringify(s)) } catch { /* fine */ } }

export default function Overview() {
  const entities = useEntities()
  const [asOf, setAsOf] = useState(today())
  const [biz, setBiz] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('')            // '' | asset | liability
  const [source, setSource] = useState('')        // '' | tracked | typed
  const [dueWithin, setDueWithin] = useState('')  // '' | days
  const [view, setView] = useState('grouped')     // grouped | flat
  const [sort, setSort] = useState({ key: 'default', dir: 1 })
  const [shut, setShut] = useState(() => readShut())   // null until the first load decides

  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [draft, setDraft] = useState({})          // position_id -> typed balance (string)
  const [editing, setEditing] = useState(null)    // a row, 'new', or null

  const [classes, setClasses] = useState([])
  const [accounts, setAccounts] = useState([])

  const [picked, setPicked] = useState([])        // position ids ticked to graph
  const [pickedGroups, setPickedGroups] = useState([])
  const [netTick, setNetTick] = useState(false)
  const [chartOpen, setChartOpen] = useState(false)
  const [chartFrom, setChartFrom] = useState('')   // '' = all history

  useEffect(() => {
    let live = true
    setErr('')
    rpc('financial_overview', { p_as_of: asOf || today(), p_include_hidden: showHidden })
      .then(r => { if (live) setRows(r) })
      .catch(e => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [asOf, showHidden, reload])

  useEffect(() => {
    supabase.from('position_classes').select('code,label,group_label,group_sort,sort_order')
      .order('group_sort').order('sort_order')
      .then(({ data, error }) => error ? setErr('position_classes: ' + error.message) : setClasses(data || []))
    supabase.from('accounts').select('id,name,account_type,active').order('name')
      .then(({ data }) => setAccounts(data || []))
  }, [])

  // First load: everything shut except cards and lines of credit, unless the
  // reader already chose otherwise on an earlier visit.
  useEffect(() => {
    if (rows && shut === null) {
      const s = [...new Set(rows.map(r => r.group_code))].filter(g => !OPEN_BY_DEFAULT.includes(g))
      setShut(s)
    }
  }, [rows, shut])
  useEffect(() => { if (shut) writeShut(shut) }, [shut])

  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') setEditing(null) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [])

  const shutSet = useMemo(() => new Set(shut || []), [shut])

  // Entity applies to everything on the page, the tiles included. Search and
  // the other filters only narrow the table — the tiles stay the whole picture.
  const scoped = useMemo(() => (rows || []).filter(r => !biz || r.business === biz), [rows, biz])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return scoped.filter(r => {
      if (kind && r.kind !== kind) return false
      if (source === 'tracked' && !r.linked) return false
      if (source === 'typed' && r.linked) return false
      if (dueWithin && !(isNum(r.days_to_due) && r.days_to_due >= 0 && r.days_to_due <= Number(dueWithin))) return false
      if (q) {
        const hay = [r.name, r.notes, r.funding, r.class_label, r.group_label, r.business, r.basis, r.pay_method]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [scoped, search, kind, source, dueWithin])

  const sorted = useMemo(() => {
    const cmp = comparator(sort.key, sort.dir)
    return cmp ? shown.slice().sort(cmp) : shown
  }, [shown, sort])

  // Groups keep the function's own order (group_sort); rows inside follow the sort.
  const groups = useMemo(() => {
    const out = []
    for (const r of sorted) {
      let g = out.find(x => x.code === r.group_code)
      if (!g) { g = { code: r.group_code, label: r.group_label, sort: num(r.group_sort), rows: [] }; out.push(g) }
      g.rows.push(r)
    }
    return out.sort((a, b) => a.sort - b.sort)
  }, [sorted])

  // ---- the tiles ----
  const live = scoped.filter(r => r.active)
  const assets = live.filter(r => r.kind === 'asset').reduce((a, r) => a + num(r.balance), 0)
  const debts = live.filter(r => r.kind === 'liability').reduce((a, r) => a + num(r.balance), 0)
  const net = assets + debts
  const annual = live.filter(r => r.kind === 'liability')
    .reduce((a, r) => a + Math.abs(num(r.balance)) * num(r.effective_rate), 0)
  const dueSoon = live.filter(r => isNum(r.days_to_due) && r.days_to_due >= 0 && r.days_to_due <= 14)
    .sort((a, b) => a.days_to_due - b.days_to_due)
  const dueSoonAmt = dueSoon.reduce((a, r) => a + num(r.min_due), 0)
  const revolving = live.filter(r => REVOLVING.includes(r.group_code) && num(r.credit_limit) > 0)
  const revLimit = revolving.reduce((a, r) => a + num(r.credit_limit), 0)
  const revOwed = revolving.reduce((a, r) => a + Math.abs(num(r.balance)), 0)
  const overLimit = revolving.filter(r => num(r.available) < 0)
  const reverting = live.filter(r => r.promo_ends && isNum(r.promo_days_left) && r.promo_days_left >= 0
      && r.promo_days_left <= 90 && isNum(r.promo_rate) && num(r.promo_rate) !== num(r.rate))
    .sort((a, b) => a.promo_days_left - b.promo_days_left)
  const typedCount = live.filter(r => !r.linked).length

  const filtering = !!(search.trim() || kind || source || dueWithin)
  const dirty = Object.keys(draft).length

  // ---- actions ----
  function clickSort(key) {
    setSort(s => s.key === key ? { key, dir: -s.dir } : { key, dir: SORTS[key].dir })
  }
  function pickSort(key) { setSort({ key, dir: SORTS[key].dir || 1 }) }

  const toggleGroup = code => setShut(s => {
    const cur = s || []
    return cur.includes(code) ? cur.filter(x => x !== code) : [...cur, code]
  })
  const anyOpen = groups.some(g => !shutSet.has(g.code))
  const collapseAll = () => setShut(anyOpen ? [...new Set((rows || []).map(r => r.group_code))] : [])

  const togglePick = id => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  const toggleGroupPick = code => setPickedGroups(p => p.includes(code) ? p.filter(x => x !== code) : [...p, code])
  const clearPicks = () => { setPicked([]); setPickedGroups([]); setNetTick(false) }

  function openChart() {
    if (!picked.length && !pickedGroups.length && !netTick) setNetTick(true)
    setChartOpen(true)
  }

  async function saveBalances() {
    const payload = Object.entries(draft)
      .filter(([, v]) => String(v).trim() !== '' && !isNaN(Number(v)))
      .map(([position_id, v]) => ({ position_id, balance: Number(v) }))
    if (!payload.length) { setErr('Nothing typed.'); return }
    setBusy(true); setErr(''); setMsg('')
    try {
      const res = await rpc('save_position_balances', { p_as_of: asOf, p_rows: payload })
      const saved = res.filter(r => r.action === 'saved').length
      const skipped = res.filter(r => r.action !== 'saved')
      setMsg(`${saved} balance${saved === 1 ? '' : 's'} saved as at ${asOf}.`
        + (skipped.length ? ` ${skipped.map(s => s.name).join(', ')} left alone — ${skipped[0].action}.` : ''))
      setDraft({})
      setReload(t => t + 1)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  async function savePosition(p) {
    setErr(''); setMsg('')
    try {
      const res = await rpc('save_position', { p })
      const r0 = res[0] || {}
      setMsg(`${r0.name} ${r0.action}.`)
      setEditing(null)
      setReload(t => t + 1)
    } catch (e) { setErr(e.message) }
  }

  if (err && !rows) return <div className="page"><div className="err">{err}</div></div>
  if (!rows) return <div className="page"><div className="loading">Reading positions…</div></div>

  const sortArrow = key => sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''
  const Th = ({ k, children, className, style, title }) => (
    <th className={'sortable ' + (className || '') + (sort.key === k ? ' sorted' : '')} style={style}
        title={title || 'Sort by this column — click again to reverse'} onClick={() => clickSort(k)}>
      {children}{sortArrow(k)}
    </th>
  )

  const total = rs => ({
    balance: rs.reduce((a, r) => a + num(r.balance), 0),
    limit: rs.reduce((a, r) => a + num(r.credit_limit), 0),
    avail: rs.reduce((a, r) => a + (isNum(r.available) ? num(r.available) : 0), 0),
    min: rs.reduce((a, r) => a + num(r.min_due), 0),
    hasLimit: rs.some(r => isNum(r.credit_limit)),
    hasMin: rs.some(r => num(r.min_due) > 0),
    // what the group's debt costs on average, weighted by balance
    rate: (() => {
      const d = rs.filter(r => r.kind === 'liability' && isNum(r.effective_rate))
      const w = d.reduce((a, r) => a + Math.abs(num(r.balance)), 0)
      return w ? d.reduce((a, r) => a + Math.abs(num(r.balance)) * num(r.effective_rate), 0) / w : null
    })(),
  })

  const row = r => (
    <AccountRow key={r.position_id} r={r} asOf={asOf} flat={view === 'flat'}
      ticked={picked.includes(r.position_id)} onTick={() => togglePick(r.position_id)}
      draft={draft[r.position_id]}
      onDraft={v => setDraft(d => {
        const n = { ...d }
        if (v === '' || Number(v) === num(r.balance)) delete n[r.position_id]; else n[r.position_id] = v
        return n
      })}
      onEdit={() => setEditing(r)} />
  )

  return (
    <div className="page ovpage">
      <p className="hint">
        Every account, what it costs, what is due and when. Balances for accounts this system tracks
        come from the <b>last statement, moved forward by every transaction since</b> — nothing to type.
        The rest you enter when you happen to update them, and each entry keeps its own date. Tick
        accounts or a group heading to graph them; click a name to edit it.
      </p>

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      <div className="bar noprint">
        <label htmlFor="ovAsOf">As at</label>
        <input id="ovAsOf" type="date" value={asOf} onChange={e => e.target.value && setAsOf(e.target.value)} />
        <select value={biz} onChange={e => setBiz(e.target.value)} aria-label="Entity">
          <option value="">All entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        <select value={view} onChange={e => setView(e.target.value)} aria-label="Layout">
          <option value="grouped">Group by class</option>
          <option value="flat">One list</option>
        </select>
        <select value={SORTS[sort.key] ? sort.key : 'default'} onChange={e => pickSort(e.target.value)} aria-label="Sort">
          {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{k === 'default' ? 'Sort: default' : 'Sort: ' + s.label}</option>)}
        </select>
        {sort.key !== 'default' && (
          <button className="mini" title="Reverse the sort" onClick={() => setSort(s => ({ ...s, dir: -s.dir }))}>
            {sort.dir === 1 ? '▲' : '▼'}
          </button>
        )}
        <span style={{ flex: 1 }} />
        {view === 'grouped' && <button className="mini" onClick={collapseAll}>{anyOpen ? 'Collapse all' : 'Expand all'}</button>}
        <button className="mini" onClick={openChart}
                title="Graph the ticked accounts and groups. With nothing ticked, graphs net worth.">
          Graph{picked.length + pickedGroups.length ? ` ticked (${picked.length + pickedGroups.length})` : ''}
        </button>
        <button className="mini" onClick={() => setEditing('new')}>+ Add account</button>
        <button className="mini" onClick={() => window.print()}>Print / PDF</button>
      </div>

      <div className="bar noprint">
        <div className="searchbox">
          <input type="search" placeholder="Search name, note, paid from, entity…" value={search}
                 onChange={e => setSearch(e.target.value)} aria-label="Search accounts" />
        </div>
        <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Assets or debts">
          <option value="">Assets and debts</option>
          <option value="asset">Assets only</option>
          <option value="liability">Debts only</option>
        </select>
        <select value={source} onChange={e => setSource(e.target.value)} aria-label="Tracked or typed">
          <option value="">Tracked and typed</option>
          <option value="tracked">Tracked from statements</option>
          <option value="typed">Typed by you</option>
        </select>
        <select value={dueWithin} onChange={e => setDueWithin(e.target.value)} aria-label="Due within">
          <option value="">Any due date</option>
          <option value="7">Due in 7 days</option>
          <option value="14">Due in 14 days</option>
          <option value="30">Due in 30 days</option>
        </select>
        <label className="chk">
          <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
          Show hidden
        </label>
        {filtering && (
          <button className="mini" onClick={() => { setSearch(''); setKind(''); setSource(''); setDueWithin('') }}>
            Clear filters
          </button>
        )}
      </div>

      <div className="grid ovstats">
        <div className="stat"><div className="n">${money(assets)}</div><div className="l">Assets</div></div>
        <div className="stat"><div className="n neg">${money(Math.abs(debts))}</div><div className="l">Owed</div></div>
        <div className="stat">
          <div className={'n ' + (net < 0 ? 'neg' : 'pos')}>{signed(net)}</div>
          <div className="l">Net worth</div>
        </div>
        <div className="stat">
          <div className="n">${money(annual)}</div>
          <div className="l">Interest a year at today’s rates</div>
          <div className="sub">about ${money(annual / 12)} a month</div>
        </div>
        <div className="stat">
          <div className={'n ' + (dueSoon.length ? 'warn' : '')}>{dueSoon.length}</div>
          <div className="l">Due in 14 days</div>
          <div className="sub">${money(dueSoonAmt)} in minimums</div>
        </div>
        <div className="stat">
          <div className="n">${money(revLimit - revOwed)}</div>
          <div className="l">Credit available</div>
          <div className="sub">
            {revLimit ? `${(100 * revOwed / revLimit).toFixed(0)}% of $${money(revLimit)} used` : '—'}
            {overLimit.length > 0 && <span className="neg"> · {overLimit.length} over limit</span>}
          </div>
        </div>
      </div>

      {dueSoon.length > 0 && (
        <div className="note warn">
          <b>Due next:</b>{' '}
          {dueSoon.map((r, i) => (
            <span key={r.position_id}>
              {i > 0 && ' · '}
              {r.name} ${money(r.min_due)} {r.days_to_due === 0 ? 'today' : `in ${r.days_to_due}d`} ({shortDate(r.due_date)})
              {r.funding ? ` from ${r.funding}` : ''}{r.pay_method === 'Manual' ? ' — manual' : ''}
            </span>
          ))}
        </div>
      )}

      {reverting.length > 0 && (
        <div className="note bad">
          <b>Promotional rates ending within 90 days:</b>{' '}
          {reverting.map((r, i) => (
            <span key={r.position_id}>
              {i > 0 && '; '}
              {r.name} — ${money(Math.abs(num(r.balance)))} goes from {pct(r.promo_rate)} to {pct(r.rate)} on {shortDate(r.promo_ends)} ({r.promo_days_left}d),
              about ${money(Math.abs(num(r.balance)) * (num(r.rate) - num(r.promo_rate)) / 12)} a month more
            </span>
          ))}
        </div>
      )}

      {sort.key === 'rate' && (
        <div className="note">
          <b>Sorted by what the money actually costs today.</b> Where a promotional rate is running it is
          used until it expires, then the standard rate takes over — so a balance that looks cheap now but
          reverts shortly is not treated as cheap. Paying the top of this list down first has the largest
          effect on interest.
        </div>
      )}

      {editing && (
        <EditPosition row={editing === 'new' ? null : editing} classes={classes} accounts={accounts}
                      entities={entities} onSave={savePosition} onCancel={() => setEditing(null)} />
      )}

      {chartOpen && (
        <OverviewChart rows={scoped} asOf={asOf} from={chartFrom} setFrom={setChartFrom}
                       picked={picked} pickedGroups={pickedGroups} net={netTick} setNet={setNetTick}
                       onClear={clearPicks} onClose={() => setChartOpen(false)} />
      )}

      {dirty > 0 && (
        <div className="note warn savebar noprint">
          <span>{dirty} typed balance{dirty === 1 ? '' : 's'} changed — saved as at <b>{asOf}</b>.</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => setDraft({})} disabled={busy}>Discard</button>
          <button className="primary" onClick={saveBalances} disabled={busy}>
            {busy ? 'Saving…' : 'Save typed balances'}
          </button>
        </div>
      )}

      <div className="card ovcard">
        {!sorted.length ? (
          <div className="empty muted">{rows.length ? 'Nothing matches those filters.' : 'No positions.'}</div>
        ) : (
          <table className="ovt">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <Th k="name">Account</Th>
                <Th k="balance" className="num" style={{ width: 118 }}>Balance</Th>
                <Th k="limit" className="num" style={{ width: 96 }}>Limit</Th>
                <Th k="available" className="num" style={{ width: 96 }}>Available</Th>
                <Th k="used" className="num" style={{ width: 92 }}>Used</Th>
                <Th k="rate" className="num" style={{ width: 82 }}>Rate</Th>
                <Th k="min" className="num" style={{ width: 84 }}>Min due</Th>
                <Th k="due" style={{ width: 96 }}>Due</Th>
                <Th k="funding" style={{ width: 160 }}>Paid from</Th>
              </tr>
            </thead>
            <tbody>
              {view === 'flat' ? sorted.map(row) : groups.map(g => {
                const open = !shutSet.has(g.code)
                const t = total(g.rows)
                const soon = g.rows.filter(r => isNum(r.days_to_due) && r.days_to_due >= 0 && r.days_to_due <= 7).length
                const over = g.rows.filter(r => isNum(r.available) && num(r.available) < 0 && num(r.credit_limit) > 0).length
                const multiClass = new Set(g.rows.map(r => r.class_label)).size > 1
                let lastClass = ''
                return (
                  <Fragment key={g.code}>
                    <tr className={'ovgrp' + (open ? ' open' : '')}>
                      <td onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={pickedGroups.includes(g.code)}
                               onChange={() => toggleGroupPick(g.code)} title="Tick to graph the whole group" />
                      </td>
                      <td onClick={() => toggleGroup(g.code)} className="ovgrpname">
                        <span className="caretw">{open ? '▾' : '▸'}</span>
                        {g.label}
                        <span className="muted ovcount"> {g.rows.length} account{g.rows.length === 1 ? '' : 's'}</span>
                        {!open && soon > 0 && <span className="pill hold">{soon} due in 7d</span>}
                        {!open && over > 0 && <span className="pill bad">{over} over limit</span>}
                      </td>
                      <td className={'num ' + (t.balance < 0 ? 'neg' : '')} onClick={() => toggleGroup(g.code)}>{signed(t.balance)}</td>
                      <td className="num" onClick={() => toggleGroup(g.code)}>{t.hasLimit ? '$' + money(t.limit) : ''}</td>
                      <td className={'num ' + (t.hasLimit && t.avail < 0 ? 'neg' : '')} onClick={() => toggleGroup(g.code)}>{t.hasLimit ? signed(t.avail) : ''}</td>
                      <td className="num" onClick={() => toggleGroup(g.code)}>
                        {t.hasLimit && t.limit > 0 ? <Usage pct={100 * Math.abs(t.balance) / t.limit} /> : ''}
                      </td>
                      <td className="num ovsub" onClick={() => toggleGroup(g.code)}
                          title="Average rate, weighted by balance">{t.rate != null ? pct(t.rate) + ' avg' : ''}</td>
                      <td className="num" onClick={() => toggleGroup(g.code)}>{t.hasMin ? '$' + money(t.min) : ''}</td>
                      <td colSpan={2} onClick={() => toggleGroup(g.code)} />
                    </tr>
                    {open && g.rows.map(r => {
                      let sub = null
                      if (multiClass && sort.key === 'default' && r.class_label !== lastClass) {
                        lastClass = r.class_label
                        const cr = g.rows.filter(x => x.class_label === r.class_label)
                        const ct = cr.reduce((a, x) => a + num(x.balance), 0)
                        sub = (
                          <tr className="ovcls" key={'c-' + r.class_label}>
                            <td /><td>{r.class_label} <span className="muted">· {cr.length}</span></td>
                            <td className={'num ' + (ct < 0 ? 'neg' : '')}>{signed(ct)}</td>
                            <td colSpan={7} />
                          </tr>
                        )
                      }
                      return <Fragment key={r.position_id}>{sub}{row(r)}</Fragment>
                    })}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot>
              {(() => {
                const t = total(sorted)
                return (
                  <tr className="total">
                    <td />
                    <td>{filtering || biz ? 'Shown' : 'All accounts'} · {sorted.length}</td>
                    <td className={'num ' + (t.balance < 0 ? 'neg' : '')}>{signed(t.balance)}</td>
                    <td className="num">{t.hasLimit ? '$' + money(t.limit) : ''}</td>
                    <td className="num">{t.hasLimit ? signed(t.avail) : ''}</td>
                    <td /><td />
                    <td className="num">{t.hasMin ? '$' + money(t.min) : ''}</td>
                    <td colSpan={2} className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                      {typedCount} typed by hand
                    </td>
                  </tr>
                )
              })()}
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}

/** A legend key: a filled square, or a dashed stroke for the sum line. */
function Swatch({ s }) {
  return s.dashed
    ? <i className="dashkey" style={{ borderTopColor: s.colour }} />
    : <i style={{ background: s.colour }} />
}

function Usage({ pct: p }) {
  const v = Math.max(0, num(p))
  const tone = v >= 90 ? 'bad' : v >= 75 ? 'warn' : ''
  return (
    <span className="usage" title={v.toFixed(1) + '% of the limit used'}>
      <span className="ubar"><i className={tone} style={{ width: Math.min(100, v) + '%' }} /></span>
      <span className={tone === 'bad' ? 'neg' : ''}>{v.toFixed(0)}%</span>
    </span>
  )
}

function AccountRow({ r, asOf, flat, ticked, onTick, draft, onDraft, onEdit }) {
  const [focus, setFocus] = useState(false)
  const promoLive = isNum(r.promo_rate) && num(r.promo_rate) !== num(r.rate)
    && (!r.promo_ends || num(r.promo_days_left) >= 0)
  const soon = isNum(r.days_to_due) && r.days_to_due >= 0 && r.days_to_due <= 7
  const entered = /^entered (\d{4}-\d{2}-\d{2})/.exec(r.basis || '')
  const age = entered ? daysBetween(entered[1], asOf) : null
  const stale = age != null && age > 45
  const over = isNum(r.available) && num(r.available) < 0 && num(r.credit_limit) > 0
  return (
    <tr className={(ticked ? 'rowsel ' : '') + (!r.active ? 'ovhidden' : '')}>
      <td><input type="checkbox" checked={ticked} onChange={onTick} title="Tick to graph" /></td>
      <td>
        <button className="linkish" onClick={onEdit} title="Rename, reclass, change terms or hide">{r.name}</button>
        <span className={'pill ' + (r.linked ? 'soft' : 'hold')}
              title={r.linked ? r.basis : 'Typed by you — ' + r.basis}>{r.linked ? 'tracked' : 'typed'}</span>
        <span className="pill">{r.business}</span>
        {!r.active && <span className="pill bad">hidden</span>}
        <div className="ovsub">
          {flat && <span>{r.group_label}{r.class_label !== r.group_label ? ' › ' + r.class_label : ''} · </span>}
          <span className={stale ? 'due-soon' : ''} title={stale ? 'Typed balance not updated in ' + age + ' days' : undefined}>
            {r.basis}{stale ? ` (${age}d old)` : ''}
          </span>
          {r.notes && <span> · {r.notes}</span>}
        </div>
      </td>
      <td className={'num ' + (num(r.balance) < 0 ? 'neg' : '')}>
        {r.linked ? signed(r.balance) : (
          // Reads as money like every other row; turns into the raw figure once clicked.
          <input type="text" inputMode="decimal"
                 className={'ovbal' + (draft != null ? ' changed' : '') + (num(draft ?? r.balance) < 0 ? ' neg' : '')}
                 value={focus ? (draft ?? num(r.balance)) : signed(draft ?? r.balance)}
                 onBlur={() => setFocus(false)}
                 onFocus={e => { setFocus(true); const t = e.target; requestAnimationFrame(() => t.select()) }}
                 onChange={e => onDraft(e.target.value.replace(/[$,\s]/g, '').replace('−', '-'))}
                 title={'Typed balance — ' + r.basis + '. Click to change; debts are negative. Saved at the As-at date.'} />
        )}
      </td>
      <td className="num">{isNum(r.credit_limit) && num(r.credit_limit) ? '$' + money(r.credit_limit) : ''}</td>
      <td className={'num ' + (over ? 'neg' : '')}>
        {isNum(r.available) && num(r.credit_limit) ? signed(r.available) : ''}
      </td>
      <td className="num">{isNum(r.usage_pct) ? <Usage pct={r.usage_pct} /> : ''}</td>
      <td className="num">
        {isNum(r.rate) || isNum(r.effective_rate) ? (
          <>
            {pct(r.effective_rate)}
            {promoLive && (
              <div className="ovrate">
                <span className="pos">promo{r.promo_ends ? ' to ' + shortDate(r.promo_ends) : ''}</span>
                <div>then {pct(r.rate)}</div>
              </div>
            )}
          </>
        ) : ''}
      </td>
      <td className="num">{num(r.min_due) ? '$' + money(r.min_due) : ''}</td>
      <td className={soon ? 'due-soon' : ''}>
        {r.due_date ? shortDate(r.due_date) : ''}
        {isNum(r.days_to_due) && (
          <div className="ovsub">{r.days_to_due < 0 ? Math.abs(r.days_to_due) + 'd ago'
            : r.days_to_due === 0 ? 'today' : 'in ' + r.days_to_due + 'd'}</div>
        )}
      </td>
      <td style={{ fontSize: 12 }}>
        {r.funding}
        {r.pay_method && <span className={'pill ' + (r.pay_method === 'Auto' ? 'soft' : 'hold')}>{r.pay_method}</span>}
      </td>
    </tr>
  )
}

/** Rename, reclass, re-note, change terms — and hide the ones that are finished with. */
function EditPosition({ row, classes, accounts, entities, onSave, onCancel }) {
  const isNew = !row
  const asPct = v => isNum(v) ? String(+(num(v) * 100).toFixed(4)) : ''
  const init = useMemo(() => ({
    name: row?.name || '',
    class_code: row?.class_code || 'other_assets',
    business_code: row?.business || 'PER',
    notes: row?.notes || '',
    active: row ? !!row.active : true,
    credit_limit: isNum(row?.credit_limit) ? String(row.credit_limit) : '',
    rate: asPct(row?.rate),
    promo_rate: asPct(row?.promo_rate),
    promo_ends: row?.promo_ends || '',
    min_due: isNum(row?.min_due) ? String(row.min_due) : '',
    due_date: row?.due_date || '',
    pay_method: row?.pay_method || '',
    funding_account_id: row?.funding_id || '',
  }), [row])
  const [f, setF] = useState(init)
  useEffect(() => setF(init), [init])
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const [localErr, setLocalErr] = useState('')
  const box = useRef(null)
  // The name clicked may be far down the table; bring the form to it.
  useEffect(() => { box.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [row])

  const funders = accounts.filter(a =>
    (a.active && ['chequing', 'savings', 'other'].includes(a.account_type)) || a.id === f.funding_account_id)

  function build(extra) {
    if (!f.name.trim()) { setLocalErr('It needs a name.'); return null }
    // Only what changed is sent: save_position leaves anything absent alone, so
    // an untouched due date never rewrites the schedule's anchor.
    const p = { id: row?.position_id || null }
    const always = isNew ? ['name', 'class_code', 'business_code', 'notes'] : []
    for (const k of Object.keys(f)) {
      if (!always.includes(k) && String(f[k]) === String(init[k])) continue
      let v = f[k]
      if (k === 'name' || k === 'notes') v = String(v).trim()
      if (k === 'rate' || k === 'promo_rate') v = String(v).trim() === '' ? '' : String(Number(v) / 100)
      p[k] = v
    }
    return Object.assign(p, extra || {})
  }
  const save = extra => { const p = build(extra); if (p) onSave(p) }

  return (
    <div className="card ovedit noprint" ref={box}>
      <h2>
        {isNew ? 'New account' : 'Editing ' + row.name}
        {row?.linked && <span className="pill soft" title={row.basis}>balance tracked from statements</span>}
      </h2>
      {localErr && <div className="err">{localErr}</div>}
      <div className="ovform">
        <label className="w2">Name<input value={f.name} onChange={set('name')} autoFocus /></label>
        <label>Class
          <select value={f.class_code} onChange={set('class_code')}>
            {classes.map(c => <option key={c.code} value={c.code}>{c.group_label} › {c.label}</option>)}
            {!classes.some(c => c.code === f.class_code) && <option value={f.class_code}>{row?.class_label || f.class_code}</option>}
          </select>
        </label>
        <label>Entity
          <select value={f.business_code} onChange={set('business_code')}>
            {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
            {!entities.some(b => b.code === f.business_code) && <option value={f.business_code}>{f.business_code}</option>}
          </select>
        </label>
        <label className="w3">Note — shown under the name<input value={f.notes} onChange={set('notes')} /></label>
        <label className="chk"><input type="checkbox" checked={f.active} onChange={set('active')} /> In use</label>
      </div>
      <div className="ovform">
        <label>Credit limit<input type="number" step="0.01" value={f.credit_limit} onChange={set('credit_limit')} /></label>
        <label>Rate %<input type="number" step="0.01" value={f.rate} onChange={set('rate')} placeholder="e.g. 20.99" /></label>
        <label>Promo rate %<input type="number" step="0.01" value={f.promo_rate} onChange={set('promo_rate')} /></label>
        <label>Promo ends<input type="date" value={f.promo_ends} onChange={set('promo_ends')} /></label>
        <label>Minimum due<input type="number" step="0.01" value={f.min_due} onChange={set('min_due')} /></label>
        <label title="The schedule repeats monthly from this date.">Next due<input type="date" value={f.due_date} onChange={set('due_date')} /></label>
        <label>Paid
          <select value={f.pay_method} onChange={set('pay_method')}>
            <option value="">—</option><option value="Auto">Auto</option><option value="Manual">Manual</option>
          </select>
        </label>
        <label className="w2">Paid from
          <select value={f.funding_account_id} onChange={set('funding_account_id')}>
            <option value="">—</option>
            {funders.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>
      {isNew && <p className="hint">A new account starts as a typed balance. Enter its amount in the table once it appears, then save.</p>}
      <div className="ovbtns">
        <button className="primary" onClick={() => save()}>Save</button>
        <button onClick={onCancel}>Cancel</button>
        {!isNew && row.active && <button onClick={() => save({ active: false })}>Hide — no longer in use</button>}
        {!isNew && !row.active && <button onClick={() => save({ active: true })}>Show again</button>}
      </div>
    </div>
  )
}

/**
 * Balance history for the ticked accounts and groups, month-end by month-end.
 *
 * Read from financial_overview at each date rather than from position_snapshots,
 * so a TRACKED account has a history too — the console's graph only ever had the
 * typed ones. A date with no balance recorded is a gap in the line, not a zero.
 */
function OverviewChart({ rows, asOf, from, setFrom, picked, pickedGroups, net, setNet, onClear, onClose }) {
  const colours = useRef(new Map())
  const [hist, setHist] = useState(null)          // { asOf, dates[], at: Map(date -> Map(id -> point)) }
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [asTable, setAsTable] = useState(false)
  const [hover, setHover] = useState(null)
  const [sumTick, setSumTick] = useState(false)
  const svgRef = useRef(null)
  const canSum = picked.length + pickedGroups.length >= 2

  // One call returns every account's month-end balance across all the history
  // held — statements where they exist, the old spreadsheet's figures before
  // that. Fetched once per As-at date; changing the range or the ticks after
  // that is instant.
  useEffect(() => {
    if (hist?.asOf === asOf) return
    let live = true
    setLoading(true); setErr('')
    rpc('web_position_history', { p_from: null, p_to: asOf, p_ids: null })
      .then(res => {
        if (!live) return
        const at = new Map()
        for (const x of res) {
          let m = at.get(x.as_of)
          if (!m) at.set(x.as_of, m = new Map())
          m.set(x.position_id, x)
        }
        setHist({ asOf, dates: [...at.keys()].sort(), at })
      })
      .catch(e => { if (live) setErr(e.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [asOf, hist])

  const dates = useMemo(() => (hist?.dates || []).filter(d => !from || d >= from), [hist, from])
  const data = hist && dates.length ? hist : null

  const series = useMemo(() => {
    if (!data) return []
    const valAt = (d, id) => {
      const x = hist.at.get(d)?.get(id)
      return !x || x.basis === NO_BALANCE ? null : num(x.balance)
    }
    const basisAt = (d, id) => hist.at.get(d)?.get(id)?.basis || ''
    const sumAt = (d, ids) => {
      let s = 0, n = 0
      for (const id of ids) { const v = valAt(d, id); if (v != null) { s += v; n++ } }
      return n ? s : null
    }
    const out = []
    const activeIds = rows.filter(r => r.active).map(r => r.position_id)
    if (net) out.push({ key: 'net', name: 'Net worth', pts: dates.map(d => sumAt(d, activeIds)) })
    for (const g of pickedGroups) {
      const rs = rows.filter(r => r.group_code === g)
      if (!rs.length) continue
      out.push({ key: 'g:' + g, name: rs[0].group_label + ' (group)', pts: dates.map(d => sumAt(d, rs.map(r => r.position_id))) })
    }
    for (const id of picked) {
      const r = rows.find(x => x.position_id === id)
      if (!r) continue
      out.push({ key: id, name: r.name, pts: dates.map(d => valAt(d, id)), why: dates.map(d => basisAt(d, id)) })
    }
    // The ticked groups and accounts added together. Each account counts once:
    // ticking a card AND the Credit cards group must not add that card twice.
    // Net worth is left out — it is already a total of everything.
    if (sumTick && canSum) {
      const ids = new Set(picked.filter(id => rows.some(r => r.position_id === id)))
      for (const g of pickedGroups) rows.filter(r => r.group_code === g).forEach(r => ids.add(r.position_id))
      const overlap = picked.length + pickedGroups.reduce((a, g) => a + rows.filter(r => r.group_code === g).length, 0) - ids.size
      out.push({ key: 'sum', name: 'Sum of ticked', dashed: true, overlap,
                 pts: dates.map(d => sumAt(d, [...ids])) })
    }
    // Colour follows the series, not its position: unticking one never repaints the rest.
    const keys = new Set(out.map(s => s.key))
    for (const k of [...colours.current.keys()]) if (!keys.has(k)) colours.current.delete(k)
    for (const s of out) {
      if (!colours.current.has(s.key)) {
        const used = new Set(colours.current.values())
        const slot = SERIES.find(c => !used.has(c))
        colours.current.set(s.key, slot || null)
      }
      s.colour = colours.current.get(s.key)
    }
    return out
  }, [data, hist, dates, rows, picked, pickedGroups, net, sumTick, canSum])

  const drawn = series.filter(s => s.colour)
  const dropped = series.length - drawn.length

  // ---- geometry ----
  const W = 960, H = 320, PT = 14, PB = 30, PL = 64
  const direct = drawn.length > 0 && drawn.length <= 4
  const PR = direct ? 132 : 18
  const vals = drawn.flatMap(s => s.pts).filter(v => v != null)
  const ticks = vals.length ? niceTicks(Math.min(0, ...vals), Math.max(0, ...vals)) : [0, 1]
  const lo = ticks[0], hi = ticks[ticks.length - 1]
  const tms = dates.map(d => Date.parse(d + 'T00:00:00Z'))
  const t0 = tms[0], t1 = tms[tms.length - 1]
  const x = i => PL + (t1 === t0 ? 0.5 : (tms[i] - t0) / (t1 - t0)) * (W - PL - PR)
  const y = v => PT + (hi - v) * (H - PT - PB) / ((hi - lo) || 1)
  const labelEvery = Math.max(1, Math.ceil(dates.length / 9))

  // direct labels at each line's last point, nudged apart
  const ends = direct ? drawn.map(s => {
    let i = s.pts.length - 1
    while (i >= 0 && s.pts[i] == null) i--
    return i < 0 ? null : { s, i, y: y(s.pts[i]) }
  }).filter(Boolean).sort((a, b) => a.y - b.y) : []
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14

  function onMove(e) {
    const box = svgRef.current?.getBoundingClientRect()
    if (!box) return
    const sx = (e.clientX - box.left) * W / box.width
    let best = 0
    for (let i = 1; i < dates.length; i++) if (Math.abs(x(i) - sx) < Math.abs(x(best) - sx)) best = i
    setHover({ i: best, left: x(best) / W * box.width, flip: x(best) > W * 0.6 })
  }

  const nothing = !picked.length && !pickedGroups.length && !net
  const yr = Number(asOf.slice(0, 4))
  const ranges = [
    ['All', ''],
    ['3 years', `${yr - 3}${asOf.slice(4)}`],
    ['1 year', `${yr - 1}${asOf.slice(4)}`],
    ['This year', `${yr}-01-01`],
  ]

  return (
    <div className="card ovchart">
      <div className="ovchartbar noprint">
        <h2 style={{ margin: 0 }}>Balance history</h2>
        <span style={{ flex: 1 }} />
        <label className="chk" title={canSum ? 'Add a line that totals every ticked group and account'
                                              : 'Tick at least two groups or accounts to add them together'}
               style={canSum ? undefined : { opacity: .5 }}>
          <input type="checkbox" checked={sumTick && canSum} disabled={!canSum}
                 onChange={e => setSumTick(e.target.checked)} /> Sum of ticked
        </label>
        <label className="chk"><input type="checkbox" checked={net} onChange={e => setNet(e.target.checked)} /> Net worth</label>
        <span className="seg">
          {ranges.map(([label, v]) => (
            <button key={label} className={'mini' + (from === v ? ' on' : '')} onClick={() => setFrom(v)}>{label}</button>
          ))}
        </span>
        <label htmlFor="ovFrom" className="muted" style={{ fontSize: 12 }}>From</label>
        <input id="ovFrom" type="date" value={from || (hist?.dates[0] || '')} max={asOf}
               onChange={e => setFrom(e.target.value)} style={{ width: 150 }} />
        <button className="mini" onClick={() => setAsTable(t => !t)}>{asTable ? 'Show graph' : 'Show as table'}</button>
        <button className="mini" onClick={onClear}>Clear ticks</button>
        <button className="mini" onClick={onClose}>Close</button>
      </div>
      {err && <div className="err">{err}</div>}
      {nothing ? (
        <div className="muted" style={{ padding: '18px 0' }}>Tick accounts, a group heading, or Net worth.</div>
      ) : loading || !hist ? (
        <div className="loading">Reading balance history…</div>
      ) : !data ? (
        <div className="muted" style={{ padding: '18px 0' }}>No history in that range.</div>
      ) : asTable ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="ovchtable">
            <thead><tr><th>Date</th>{series.map(s => <th key={s.key} className="num">{s.name}</th>)}</tr></thead>
            <tbody>
              {dates.map((d, i) => (
                <tr key={d}><td>{d}</td>{series.map(s => (
                  <td key={s.key} className={'num ' + (s.pts[i] < 0 ? 'neg' : '')}>{s.pts[i] == null ? '—' : signed(s.pts[i])}</td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ovplot" onMouseLeave={() => setHover(null)}>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} role="img"
               aria-label={'Balance history: ' + drawn.map(s => s.name).join(', ')}>
            {ticks.map(t => (
              <g key={t}>
                <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#94a3b8' : '#eef0f3'}
                      strokeDasharray={t === 0 ? '3 3' : undefined} />
                <text x={PL - 8} y={y(t) + 4} textAnchor="end" className="axis">{shortMoney(t)}</text>
              </g>
            ))}
            {dates.map((d, i) => {
              const last = i === dates.length - 1
              // a regular label too close to the final one would print over it
              if (!last && (i % labelEvery !== 0 || x(dates.length - 1) - x(i) < 70)) return null
              return (
              <text key={d} x={x(i)} y={H - 10} textAnchor="middle" className="axis">
                {last && d.slice(8) !== '31' && d.slice(8) !== '30' ? shortDate(d) : d.slice(0, 7)}
              </text>
            )})}
            {hover && <line x1={x(hover.i)} x2={x(hover.i)} y1={PT} y2={H - PB} stroke="#94a3b8" />}
            {drawn.map(s => {
              const segs = []; let cur = []
              s.pts.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = [] } else cur.push([x(i), y(v)]) })
              if (cur.length) segs.push(cur)
              return (
                <g key={s.key}>
                  {segs.map((p, k) => p.length > 1
                    ? <polyline key={k} points={p.map(q => q.join(',')).join(' ')} fill="none" stroke={s.colour}
                                strokeWidth={s.dashed ? 2.5 : 2} strokeDasharray={s.dashed ? '7 4' : undefined}
                                strokeLinejoin="round" strokeLinecap={s.dashed ? 'butt' : 'round'} />
                    : <circle key={k} cx={p[0][0]} cy={p[0][1]} r="3" fill={s.colour} />)}
                  {hover && s.pts[hover.i] != null && (
                    <circle cx={x(hover.i)} cy={y(s.pts[hover.i])} r="4.5" fill={s.colour} stroke="#fff" strokeWidth="2" />
                  )}
                </g>
              )
            })}
            {ends.map(e => (
              <g key={e.s.key}>
                <circle cx={W - PR + 10} cy={e.y} r="4" fill={e.s.colour} />
                <text x={W - PR + 18} y={e.y + 4} className="dlabel">
                  {e.s.name.length > 16 ? e.s.name.slice(0, 15) + '…' : e.s.name}
                </text>
              </g>
            ))}
          </svg>
          {hover && (
            <div className={'ovtip' + (hover.flip ? ' flip' : '')} style={{ left: hover.left + 12 }}>
              <div className="tipdate">{dates[hover.i]}</div>
              {drawn.map(s => ({ s, v: s.pts[hover.i], why: s.why?.[hover.i] }))
                .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity))
                .map(({ s, v, why }) => (
                  <div key={s.key}>
                    <div className="tiprow">
                      <Swatch s={s} /> <span>{s.name}</span>
                      <b className={v < 0 ? 'neg' : ''}>{v == null ? '—' : signed(v)}</b>
                    </div>
                    {why && v != null && <div className="tipwhy">{why}</div>}
                  </div>
                ))}
            </div>
          )}
          <div className="ovlegend">
            {drawn.map(s => {
              const last = [...s.pts].reverse().find(v => v != null)
              return (
                <span key={s.key}><Swatch s={s} />{s.name}
                  <span className="muted"> {last == null ? '—' : signed(last)}</span></span>
              )
            })}
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            Month-end balances, {dates[0]} to {dates[dates.length - 1]} ({dates.length} points). Accounts
            tracked from statements use them from the first statement on, and the old spreadsheet’s
            figures before that; typed accounts hold each entered figure until the next. A gap means
            nothing was recorded yet.
            {pickedGroups.length > 0 && ' A group line sums whichever of its accounts had a balance on that date.'}
            {drawn.some(s => s.key === 'sum') && ' The dashed line adds up everything ticked'
              + (drawn.find(s => s.key === 'sum').overlap > 0 ? ', counting an account once even where it is also inside a ticked group.' : '.')}
            {dropped > 0 && <b className="neg"> {dropped} more ticked than the graph can show — eight at most.</b>}
          </div>
        </div>
      )}
    </div>
  )
}
