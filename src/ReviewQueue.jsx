import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money } from './format.js'
import { useEntities } from './useEntities.js'
import TxnEditor from './TxnEditor.jsx'
import DocLink from './DocLink.jsx'
import DateRange from './DateRange.jsx'

const num = v => Number(v) || 0

/** The numbered queues, in the console's order and with its labels. */
export const QUEUES = [
  { k: 'invoices', label: '1 · Allocate invoices' },
  { k: 'docs',     label: '2 · Assign receipts to invoices' },
  { k: 'hold',     label: '3 · Transfers and payments' },
  { k: 'plain',    label: '4 · Allocate expenses' },
  { k: 'apwait',   label: '5 · Waiting on documents' },
  { k: 'docpair',  label: '6 · Document matching' },
  { k: 'reopened', label: '7 · Documents arrived after review' },
  { k: 'stmtrev',  label: '8 · Statement only — review' },
  { k: 'reviewed', label: '9 · Reviewed — reopen one' },
]

const NOTE = {
  docs: ['Assign receipts to invoices',
    'Payments the books expect an invoice behind. An explicit "apply to an invoice" mark beats both the vendor group and the absence of an invoice.'],
  plain: ['Allocate expenses',
    'What is left once every other queue has taken its own — ordinary purchases with no named vendor and no paperwork outstanding.'],
  apwait: ['Waiting on documents',
    'Cannot be finished because the paperwork is not here: no invoice file, no linked invoice entry, or a document recorded from an email with no file behind it.'],
  reopened: ['Documents arrived after review',
    'Cleared once, then a receipt turned up. New evidence against an old judgement, so the judgement is shown again. Telling the document what it is moves the row on.'],
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
  const entities = useEntities()

  useEffect(() => { if (fixedKind) setKind(fixedKind) }, [fixedKind])

  useEffect(() => {
    supabase.from('v_all_outstanding').select('vendor_group')
      .not('vendor_group', 'is', null)
      .then(({ data }) => setGroups([...new Set((data || []).map(r => r.vendor_group))].sort()))
  }, [])

  const load = useCallback(async () => {
    setRows(null); setErr(''); setSel(null)
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

      {kind === 'invoices' && (
        <div className="note warn">
          The invoice queue has its own pane in the console, with the document
          viewer and the booking form. Not ported yet — use the console for this one.
        </div>
      )}
      {(kind === 'docpair' || kind === 'stmtrev') && (
        <div className="note warn">
          This queue has its own dedicated pane in the console. Not ported yet.
        </div>
      )}

      {err && <div className="err">{err}</div>}
      {!rows && !err && <div className="loading">Loading…</div>}
      {rows && rows.length === 0 && (
        <div className="card"><div className="muted">Nothing matches.</div></div>
      )}

      {rows && rows.length > 0 && (
        <div className="card">
          <table>
            <thead>
              <tr>
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
                    <td colSpan={8}>
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
