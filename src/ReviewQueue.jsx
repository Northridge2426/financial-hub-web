import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money } from './format.js'
import { useEntities } from './useEntities.js'
import TxnEditor from './TxnEditor.jsx'
import DocLink from './DocLink.jsx'
import DateRange from './DateRange.jsx'
import ProjectPicker from './ProjectPicker.jsx'

const num = v => Number(v) || 0

/**
 * The numbered queues, in the console's order and with its labels.
 *
 * 5 (Waiting on documents) and 7 (Documents arrived after review) were retired:
 * William would rather hold off reviewing a line when the information is not
 * there than work a queue for it. They are gone from this switcher as well as
 * the menu, or the pane would still reach them by dropdown. The underlying rows
 * are untouched and still excluded from queues 2 and 4 — they surface in All
 * Outstanding, where the queue pill names the state they are in.
 */
export const QUEUES = [
  { k: 'docs',     label: '2 · Assign receipts to invoices' },
  { k: 'hold',     label: '3 · Transfers and payments' },
  { k: 'plain',    label: '4 · Allocate expenses' },
  { k: 'reviewed', label: '9 · Reviewed — reopen one' },
]

const NOTE = {
  docs: ['Assign receipts to invoices',
    'Payments the books expect an invoice behind. An explicit "apply to an invoice" mark beats both the vendor group and the absence of an invoice.'],
  plain: ['Allocate expenses',
    'What is left once every other queue has taken its own — ordinary purchases with no named vendor and no paperwork outstanding.'],
  reviewed: ['Reviewed — reopen one',
    'Already done. Open one to correct the entry behind it.'],
}

/**
 * The review queues.
 *
 * The filtering lives in `web_review_queue()` rather than here. The console
 * builds that WHERE clause in JavaScript from five SQL helper functions, and
 * rebuilding it in the browser would let the two drift — which has already
 * happened once in this project, leaving eleven payments in no queue at all.
 */
export default function ReviewQueue({ kind: fixedKind }) {
  const [kind, setKind] = useState(fixedKind || 'plain')
  const [biz, setBiz] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('date')
  const [range, setRange] = useState({ from: '', to: '' })
  const [groups, setGroups] = useState([])
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState(null)
  // Ticked rows, for coding several the same way or calling them transfers. A
  // Set keyed by id, not an array of rows: the list reloads underneath and
  // stale row objects would be wrong.
  const [ticked, setTicked] = useState(() => new Set())
  const [bulk, setBulk] = useState(false)
  const [bulkOut, setBulkOut] = useState(null)
  const entities = useEntities()

  // The coding the ticked rows will all get. Kept across reloads on purpose:
  // the usual run is "code these six, then the next four the same way".
  const [accounts, setAccounts] = useState([])
  const [projects, setProjects] = useState([])
  const [bBiz, setBBiz] = useState('')
  const [bAcct, setBAcct] = useState('')
  const [bProj, setBProj] = useState([])
  const [bGst, setBGst] = useState('document')
  const [bNote, setBNote] = useState('')

  useEffect(() => { if (fixedKind) setKind(fixedKind) }, [fixedKind])

  useEffect(() => {
    supabase.from('v_chart_of_accounts').select('business,number,name')
      .eq('usable', true).eq('postable', true).order('business').order('number')
      .then(({ data }) => setAccounts(data || []))
    supabase.from('projects').select('id,name').eq('active', true).order('name')
      .then(({ data }) => setProjects(data || []))
  }, [])

  useEffect(() => {
    // The canonical list is `vendor_routes` where route = 'group' — the same
    // source queue_counts() uses. Reading it from v_all_outstanding instead
    // was wrong in BOTH directions: a group with nothing outstanding right now
    // (Apple) disappeared from the picker, so it could not be opened to confirm
    // it was empty; and four descriptors that are NOT routed as groups
    // (Starlink, Stittco, Superior Propane, Midnight Petroleum) were offered as
    // though they were, with no badge behind them.
    supabase.from('vendor_routes').select('label')
      .eq('active', true).eq('route', 'group')
      .then(({ data }) => setGroups([...new Set((data || []).map(r => r.label))].sort()))
  }, [])

  const load = useCallback(async () => {
    setRows(null); setErr(''); setSel(null); setTicked(new Set())
    try {
      setRows(await rpc('web_review_queue', {
        p_kind: kind,
        p_business: biz || null,
        p_search: search.trim() || null,
        p_sort: sort,
        p_limit: 400,
        p_from: range.from || null,
        p_to: range.to || null,
      }))
    } catch (e) { setErr(e.message) }
  }, [kind, biz, search, sort, range.from, range.to])

  useEffect(() => {
    const t = setTimeout(load, 250)   // debounce the search box
    return () => clearTimeout(t)
  }, [load])

  const note = useMemo(() => NOTE[kind] || (kind.startsWith('vg:')
    ? [kind.slice(3), 'A vendor group — every transaction whose descriptor belongs to this vendor, whatever queue it would otherwise sit in, so the whole run can be worked in one pass.']
    : null), [kind])

  const total = (rows || []).reduce((a, r) => a + num(r.amount), 0)

  function tick(id) {
    setTicked(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const tickedRows = (rows || []).filter(r => ticked.has(r.id))
  const tickedTotal = tickedRows.reduce(
    (a, r) => a + (r.direction === 'inflow' ? -1 : 1) * num(r.amount), 0)
  const allTicked = !!rows && rows.length > 0 && rows.every(r => ticked.has(r.id))
  const tickAll = () => setTicked(allTicked ? new Set() : new Set(rows.map(r => r.id)))
  const bAccounts = accounts.filter(a => a.business === bBiz)

  /**
   * Code every ticked row the same way, in one call.
   *
   * web_bulk_code() builds each entry server-side — the cost line on the
   * entity picked here, GST if asked, and the funding side from the account
   * each row actually sits on. When that card belongs to another entity it
   * writes the related-party pair as well, exactly as code_statement_lines
   * does; working that out in the browser is how one-sided entries get made.
   *
   * It writes through set_journal_override, the same path as a single Save, and
   * answers per row. A row already carrying an entry, applied to an invoice,
   * flagged as a transfer, on hold, or in a closed period is left alone and
   * named — never overwritten, and never allowed to fail the rest.
   */
  async function codeTicked(markReviewed) {
    if (!bBiz || !bAcct) { setErr('Pick the entity and account first.'); return }
    setBulk(true); setErr(''); setBulkOut(null)
    try {
      const out = await rpc('web_bulk_code', {
        p_ids: [...ticked],
        p_business: bBiz,
        p_account: bAcct,
        p_projects: bProj.length ? bProj : null,
        p_gst: bGst,
        p_mark_reviewed: markReviewed,
        p_note: bNote.trim() || null,
      })
      setBulkOut(out || [])
      await load()
    } catch (e) { setErr(e.message) }
    setBulk(false)
  }

  /**
   * "These are transfers." Books nothing — it sets the flag on each and they
   * leave this queue for Transfers and payments, where both sides get matched
   * once both have arrived. web_mark_transfers answers per row, so a
   * transaction that already carries an entry is refused on its own and named
   * rather than failing the whole batch.
   */
  async function markTransfers() {
    setBulk(true); setErr(''); setBulkOut(null)
    try {
      const out = await rpc('web_mark_transfers', { p_ids: [...ticked] })
      setBulkOut(out || [])
      await load()
    } catch (e) { setErr(e.message) }
    setBulk(false)
  }

  return (
    <div className="page">
      <div className="bar">
        <select value={kind} onChange={e => setKind(e.target.value)} style={{ minWidth: 280 }}>
          {QUEUES.map(q => <option key={q.k} value={q.k}>{q.label}</option>)}
          {groups.length > 0 && (
            <optgroup label="Vendor groups">
              {groups.map(g => <option key={g} value={'vg:' + g}>{g}</option>)}
            </optgroup>
          )}
        </select>
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">All businesses</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.code}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="date">By date</option>
          <option value="business">By business</option>
          <option value="amount">Largest first</option>
          <option value="vendor">By vendor</option>
        </select>
        <input type="search" placeholder="Descriptor, merchant or ref…" value={search}
               onChange={e => setSearch(e.target.value)} style={{ width: 240 }} />
        <DateRange value={range} onChange={setRange} />
        {rows && <span className="muted" style={{ fontSize: 12 }}>
          {rows.length}{rows.length === 400 ? '+' : ''} · ${money(total)}
        </span>}
      </div>

      {note && (
        <div className="note"><b>{note[0]}</b> — {note[1]}</div>
      )}


      {err && <div className="err">{err}</div>}
      {!rows && !err && <div className="loading">Loading…</div>}
      {rows && rows.length === 0 && (
        <div className="card"><div className="muted">Nothing matches.</div></div>
      )}

      {/* Only ever shown when something is ticked, so it cannot be mistaken for
          a filter. The count is the honest one — rows the database refuses are
          named below, not silently dropped from this number. */}
      {ticked.size > 0 && kind !== 'reviewed' && (
        <div className="bar bulkbar">
          <b>{ticked.size} ticked</b>
          <span className="muted" style={{ fontSize: 12 }}>${money(Math.abs(tickedTotal))}</span>
          <span className="sep" />
          <label>Code them all to</label>
          <select value={bBiz} onChange={e => { setBBiz(e.target.value); setBAcct('') }}>
            <option value="">entity</option>
            {entities.map(b => <option key={b.code} value={b.code}>{b.code}</option>)}
          </select>
          <select value={bAcct} onChange={e => setBAcct(e.target.value)}
                  disabled={!bBiz} style={{ minWidth: 240, maxWidth: 340 }}>
            <option value="">account</option>
            {bAccounts.map(a => (
              <option key={a.number} value={a.number}>{a.number} — {a.name}</option>
            ))}
          </select>
          <select value={bGst} onChange={e => setBGst(e.target.value)}
                  title="A bank line says nothing about tax. 'As on the receipt' uses the GST recorded from each row's document, and splits none out where there is no document.">
            <option value="document">GST as on the receipt</option>
            <option value="none">No GST split</option>
            <option value="five">GST 5% included</option>
          </select>
          <ProjectPicker value={bProj} projects={projects} onChange={setBProj} />
          <input value={bNote} onChange={e => setBNote(e.target.value)}
                 placeholder="Note (optional)" style={{ width: 160 }} />
          <button className="primary" disabled={bulk || !bBiz || !bAcct}
                  onClick={() => codeTicked(true)}>
            {bulk ? 'Coding…' : `Code ${ticked.size} and mark reviewed`}
          </button>
          <button disabled={bulk || !bBiz || !bAcct} onClick={() => codeTicked(false)}
                  title="Writes the entries but leaves them in this queue to check one by one.">
            Code, keep in queue
          </button>
          <span className="sep" />
          <button disabled={bulk} onClick={markTransfers}
                  title="Books nothing. They leave this queue for Transfers and payments, where you match both sides once both have arrived.">
            {`These ${ticked.size === 1 ? 'is a transfer' : 'are transfers'}`}
          </button>
          <button disabled={bulk} onClick={() => setTicked(new Set())}>clear</button>
        </div>
      )}

      {bulkOut && bulkOut.length > 0 && (
        <div className="note">
          {(() => {
            const done = bulkOut.filter(o => /^coded|^moved/.test(o.outcome)).length
            const left = bulkOut.length - done
            return (
              <div style={{ marginBottom: 4 }}>
                <b>{done} done</b>
                {left > 0 && <span className="neg"> · {left} left alone — see why below</span>}
              </div>
            )
          })()}
          {bulkOut.map((o, i) => (
            <div key={i} style={{ fontSize: 12 }}>
              <b>{o.ref}</b> — {o.outcome}
            </div>
          ))}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input type="checkbox" checked={allTicked} onChange={tickAll}
                         title={allTicked ? 'Untick all' : 'Tick every row shown'} />
                </th>
                <th style={{ width: 82 }}>Ref</th>
                <th style={{ width: 92 }}>Date</th>
                <th style={{ width: 56 }}>Biz</th>
                <th style={{ width: 130 }}>Account</th>
                <th>Descriptor</th>
                <th style={{ width: 140 }}>Merchant</th>
                <th className="num" style={{ width: 104 }}>Amount</th>
                <th style={{ width: 170 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => [
                <tr key={r.id} className={'drill' + (sel === r.id ? ' rowsel' : '')}
                    onClick={() => setSel(sel === r.id ? null : r.id)}>
                  {/* stopPropagation, or ticking would also open the editor */}
                  <td onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={ticked.has(r.id)}
                           onChange={() => tick(r.id)}
                           title="Tick several, then code them all the same way — or say they are transfers." />
                  </td>
                  <td className="muted">{r.ref}</td>
                  <td>{r.txn_date}</td>
                  <td><span className="pill">{r.business}</span></td>
                  <td style={{ fontSize: 12 }}>{r.account}</td>
                  <td>{String(r.description_raw || '').slice(0, 58)}</td>
                  <td>{r.merchant}</td>
                  <td className={'money ' + (r.direction === 'inflow' ? 'pos' : '')}>
                    {r.direction === 'inflow' ? '+' : '−'}${money(r.amount)}
                  </td>
                  <td style={{ fontSize: 11 }}>
                    {r.status === 'reviewed' && (
                      <span className="pill soft"
                            title={`Already reviewed${num(r.jlines) ? `, with ${r.jlines} journal line${num(r.jlines) === 1 ? '' : 's'} posted` : ''}. Open it to correct the entry.`}>
                        reviewed
                      </span>
                    )}
                    {r.already_applied && (
                      <span className="pill bad"
                            title="This payment has already been applied to its invoice, and the expense was booked against the invoice date. Coding it here would double the cost.">
                        applied
                      </span>
                    )}
                    {num(r.docs) > 0 && <span className="pill soft">{r.docs} doc</span>}
                    {r.statement_path && <DocLink path={r.statement_path} label="stmt" />}
                    {num(r.doc_stubs) > 0 && (
                      <span className="pill hold"
                            title="Recorded from an email — vendor, date and amount only. No file was ever saved, so there is nothing to open.">
                        no file
                      </span>
                    )}
                    {r.has_ev && (
                      <span className="pill"
                            title="Your general journal has posted this vendor before. Advisory only — nothing is applied automatically.">
                        ledger
                      </span>
                    )}
                    {r.journal_hold && (
                      <span className="pill hold" title={r.journal_hold_reason || 'Parked: needs an explicit contra account.'}>
                        hold
                      </span>
                    )}
                    {r.auto_reviewed && (
                      <span className="pill hold"
                            title="An import rule categorised this before you saw it. It was categorised, not verified.">
                        auto
                      </span>
                    )}
                  </td>
                </tr>,
                sel === r.id && (
                  <tr key={r.id + '-d'} className="expand">
                    <td colSpan={9}>
                      <TxnEditor txn={r} kind={kind} onDone={load} />
                    </td>
                  </tr>
                ),
              ])}
            </tbody>
          </table>
          {rows.length === 400 && (
            <p className="hint" style={{ margin: '8px 0 0' }}>
              Capped at 400 — narrow with the search box or the business filter.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
