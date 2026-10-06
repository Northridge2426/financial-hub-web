import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { money } from './format.js'
import { useEntities } from './useEntities.js'

const PAGE = 300
const COLS = 'business,entry_no,entry_date,source,reference,sage_entry,narrative,total,lines,detail,ledger_entry_id'

/**
 * What did you just type?
 *
 * The box used to assume everything was a transaction: it stripped the letters
 * and padded the digits, so "PJ0005" became "T000005" — a real but completely
 * unrelated transaction — and the entry you were looking for was reported as
 * not found. A journal number, an adjustment number and an AP number are all
 * references a person reasonably types here.
 *
 *   T000123 / t123 / 123  -> a transaction, looked up in transactions.ref
 *   PJ0005 / GJ12 / SJ7   -> a journal entry, matched on sage_entry
 *   ADJ-2026-0007         -> an adjustment, matched on reference
 *   AP-2026-0252          -> a payable, matched on reference
 */
const classify = s => {
  const t = s.trim()
  if (!t) return null
  if (/^(adj|ap)[-\s]?\d/i.test(t)) return { kind: 'reference', value: t.toUpperCase() }
  // two or more letters then digits is an entry number, not a transaction
  if (/^[a-z]{2,}\s?\d+$/i.test(t)) return { kind: 'entry', value: t.toUpperCase().replace(/\s/g, '') }
  const digits = t.replace(/^t/i, '').replace(/\D/g, '')
  return digits ? { kind: 'txn', value: 'T' + digits.padStart(6, '0') } : null
}

export default function GeneralJournal() {
  const [biz, setBiz] = useState('')
  const [source, setSource] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [refs, setRefs] = useState('')

  const [rows, setRows] = useState(null)
  const [total, setTotal] = useState(0)
  const [breakdown, setBreakdown] = useState(null)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const entities = useEntities()

  const wanted = refs.split(/[,]+/).flatMap(s => s.split(/\s+/)).map(classify).filter(Boolean)
  const searching = wanted.length > 0
  const filterKey = JSON.stringify([biz, source, from, to, wanted])

  useEffect(() => { setPage(0) }, [filterKey])

  useEffect(() => {
    const handle = setTimeout(run, 250)   // debounce the reference box
    return () => clearTimeout(handle)

    /**
     * Resolve the typed references. Null means "no filter".
     * Transaction refs have to become ids first; entry and document numbers
     * are matched on the view's own columns.
     */
    async function txnIds() {
      if (!searching) return null
      const txns = wanted.filter(w => w.kind === 'txn').map(w => w.value)
      if (!txns.length) return []
      const { data, error } = await supabase.from('transactions').select('id').in('ref', txns)
      if (error) throw new Error(error.message)
      return (data || []).map(t => t.id)
    }

    function applyFilters(qy, ids) {
      if (biz) qy = qy.eq('business', biz)
      if (source) qy = qy.eq('source', source)
      if (searching) {
        // A reference search must not be silently narrowed by the date range —
        // you asked about that entry, not about that window.
        const entries = wanted.filter(w => w.kind === 'entry').map(w => w.value)
        const docs    = wanted.filter(w => w.kind === 'reference').map(w => w.value)
        const ors = []
        if (ids.length)      ors.push(`transaction_id.in.(${ids.join(',')})`)
        if (entries.length)  ors.push(`sage_entry.in.(${entries.join(',')})`)
        if (docs.length)     ors.push(`reference.in.(${docs.join(',')})`)
        // nothing resolvable: match nothing rather than everything
        qy = ors.length ? qy.or(ors.join(',')) : qy.eq('entry_no', -1)
      } else {
        if (from) qy = qy.gte('entry_date', from)
        if (to) qy = qy.lte('entry_date', to)
      }
      return qy
    }

    async function run() {
      if (page === 0) { setRows(null); setBreakdown(null) }
      setErr(''); setBusy(true)
      try {
        // No early exit on an empty id list any more: "PJ0005" resolves to no
        // TRANSACTION and used to stop here, which is why a journal number
        // reported nothing found while its entry sat on the page. applyFilters
        // decides — it matches nothing only when nothing at all resolved.
        const ids = await txnIds()

        const { data, error, count } = await applyFilters(
          supabase.from('v_general_journal_entries').select(COLS, { count: 'exact' }), ids)
          .order('business').order('entry_date').order('entry_no')
          .range(page * PAGE, page * PAGE + PAGE - 1)
        if (error) throw new Error(error.message)

        setTotal(count ?? 0)
        setRows(prev => page === 0 ? (data || []) : [...(prev || []), ...(data || [])])

        // The source split and the adjustment total describe the WHOLE match,
        // not the page on screen — otherwise "50 adjustments" would creep
        // upward as you load more, which is worse than no number at all.
        if (page === 0) {
          const { data: all, error: e2 } = await applyFilters(
            supabase.from('v_general_journal_entries').select('source,total'), ids)
          if (e2) throw new Error(e2.message)
          const b = { adjTotal: 0 }
          for (const r of all || []) {
            b[r.source] = (b[r.source] || 0) + 1
            if (r.source === 'adjustment') b.adjTotal += Number(r.total || 0)
          }
          setBreakdown(b)
        }
      } catch (e) { setErr(e.message) }
      setBusy(false)
    }
  }, [filterKey, page])   // eslint-disable-line

  const loaded = rows ? rows.length : 0
  const hasMore = loaded < total

  return (
    <div className="page">
      <p className="hint">
        Every journal entry across the six sets of books — what came from Sage, what was raised
        here, and what was changed after import.
      </p>

      <div className="bar">
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">All entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        <select value={source} onChange={e => setSource(e.target.value)}>
          <option value="">Any source</option>
          <option value="from Sage">From Sage</option>
          <option value="new here">New here</option>
          <option value="adjustment">Adjustment</option>
        </select>
        <label htmlFor="gjFrom">From</label>
        <input id="gjFrom" type="date" value={from} disabled={searching}
               onChange={e => setFrom(e.target.value)} />
        <label htmlFor="gjTo">To</label>
        <input id="gjTo" type="date" value={to} disabled={searching}
               onChange={e => setTo(e.target.value)} />
        <input type="search" placeholder="Transaction ref, e.g. 1471" value={refs}
               onChange={e => setRefs(e.target.value)} style={{ width: 200 }} />
      </div>

      {searching && (
        <p className="hint">
          Searching by reference, so the dates are ignored — an entry you asked for by number
          shouldn't vanish because of a window you set earlier.
        </p>
      )}

      {err && <div className="err">{err}</div>}
      {!rows && !err && <div className="loading">Loading…</div>}
      {rows && rows.length === 0 && (
        <div className="card"><div className="muted">Nothing matches.</div></div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="grid" style={{ marginBottom: 14 }}>
            <div className="stat"><div className="n">{total.toLocaleString('en-CA')}</div><div className="l">entries</div></div>
            <div className="stat"><div className="n">{breakdown?.['from Sage'] ?? '…'}</div><div className="l">from Sage</div></div>
            <div className="stat"><div className="n">{breakdown?.['new here'] ?? '…'}</div><div className="l">new since import</div></div>
            <div className="stat">
              <div className={'n ' + (breakdown?.adjustment ? 'warn' : '')}>
                {breakdown?.adjustment ?? '…'}
              </div>
              <div className="l">changed a Sage import</div>
            </div>
          </div>

          {breakdown?.adjustment > 0 && (
            <div className="note warn">
              These {breakdown.adjustment} adjustments total ${money(breakdown.adjTotal)} and exist
              only here. If the Sage journal is reloaded they would be overwritten, so each one
              records what would have to be entered in Sage first — see the reason on each row.
            </div>
          )}

          <div className="card">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 62 }}>Entity</th>
                  <th style={{ width: 52 }}>No.</th>
                  <th style={{ width: 96 }}>Date</th>
                  <th style={{ width: 90 }}>Ref</th>
                  <th>Entry</th>
                  <th className="num" style={{ width: 100 }}>Total</th>
                  <th style={{ width: 118 }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.ledger_entry_id || `${r.business}-${r.entry_no}-${i}`}>
                    <td><span className="pill">{r.business}</span></td>
                    <td className="muted">{r.entry_no}</td>
                    <td>{r.entry_date}</td>
                    <td className="muted">
                      {r.reference}
                      {r.sage_entry && <div className="muted">{r.sage_entry}</div>}
                    </td>
                    <td>
                      <div>{String(r.narrative || '').slice(0, 70)}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{r.detail}</div>
                    </td>
                    <td className="money">${money(r.total)}</td>
                    <td>
                      <span className={'pill ' + (r.source === 'adjustment' ? 'hold'
                                                : r.source === 'new here' ? '' : 'soft')}>
                        {r.source}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bar" style={{ justifyContent: 'space-between' }}>
            <span className="muted" style={{ fontSize: 12 }}>
              Showing {loaded.toLocaleString('en-CA')} of {total.toLocaleString('en-CA')}
            </span>
            {hasMore && (
              <button className="primary" disabled={busy} onClick={() => setPage(p => p + 1)}>
                {busy ? 'Loading…' : `Load ${Math.min(PAGE, total - loaded)} more`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
