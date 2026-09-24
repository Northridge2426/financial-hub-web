import { useEffect, useMemo, useState } from 'react'
import { rpc } from './supabase.js'
import { money, today } from './format.js'
import { useEntities } from './useEntities.js'

const num = v => Number(v) || 0

/** Every YYYY-MM from one month to another, inclusive. */
function monthList(fromYm, toYm) {
  const out = []
  let [y, m] = fromYm.split('-').map(Number)
  const [ty, tm] = toYm.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    if (++m > 12) { m = 1; y++ }
  }
  return out
}

/**
 * Recurring payments — what bills on a rhythm, as a vendor-by-month grid.
 *
 * A blank between two payments is a month nothing arrived, and that is the
 * whole point of the view. Condensed puts a vendor's accounts back together
 * within an entity, so a bill that moved card reads as one unbroken run rather
 * than two lines each full of holes.
 */
export default function Recurring() {
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState(today())
  const [view, setView] = useState('condensed')
  const [biz, setBiz] = useState('')
  const [sort, setSort] = useState('gaps')
  const [showEx, setShowEx] = useState(false)
  const [raw, setRaw] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [tick, setTick] = useState(0)
  const [setting, setSetting] = useState(null)   // stream awaiting an entity
  const entities = useEntities()

  useEffect(() => {
    setRaw(null); setErr('')
    rpc(view === 'detail' ? 'recurring_payments' : 'recurring_payments_condensed',
        { p_from: from, p_to: to })
      .then(setRaw).catch(e => setErr(e.message))
  }, [from, to, view, tick])

  const months = useMemo(() => monthList(from.slice(0, 7), to.slice(0, 7)), [from, to])

  const streams = useMemo(() => {
    if (!raw) return []
    const S = new Map()
    for (const r of raw) {
      let s = S.get(r.stream_key)
      if (!s) {
        s = {
          key: r.stream_key, vendor: r.vendor, account: r.account,
          basis: r.biz_basis, excluded: !!r.excluded, override: r.override || '',
          rate: num(r.s_rate), months: num(r.s_months), anchor: !!r.anchor,
          acctLast: r.acct_last, cells: {}, biz: {}, total: 0, guessed: 0,
        }
        S.set(r.stream_key, s)
      }
      // The entity mix is kept from EVERY row even when a filter is on, so the
      // Entity column still says who else is on the bill rather than pretending
      // the line belongs to one party.
      s.biz[r.business] = (s.biz[r.business] || 0) + num(r.amount)
      s.guessed += num(r.guessed)
      if (biz && r.business !== biz) continue
      const c = s.cells[r.ym] || (s.cells[r.ym] = { amt: 0, n: 0 })
      c.amt += num(r.amount)
      c.n = Math.max(c.n, num(r.n_txn))
      s.total += num(r.amount)
    }
    let list = [...S.values()].filter(s => showEx || !s.excluded)
    if (biz) list = list.filter(s => Object.keys(s.cells).length > 0)

    const gapCount = s => months.filter(m => !s.cells[m]).length
    list.sort(
      sort === 'amount' ? (a, b) => b.total - a.total
      : sort === 'vendor' ? (a, b) => String(a.vendor).localeCompare(String(b.vendor))
      : (a, b) => (gapCount(b) - gapCount(a)) || (b.total - a.total))
    return list
  }, [raw, biz, sort, showEx, months])

  const colTotal = m => streams.reduce((a, s) => a + (s.cells[m]?.amt || 0), 0)
  const grand = streams.reduce((a, s) => a + s.total, 0)

  async function act(key, fn) {
    setBusy(key); setErr(''); setMsg('')
    try {
      const res = await fn()
      setMsg(typeof res === 'string' ? res : 'Done.')
      setTick(t => t + 1)
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  return (
    <div className="page">
      <p className="hint">
        What bills on a rhythm — telephone, power, propane, insurance, subscriptions, interest and
        bank charges. A blank <i>between</i> two payments is a month nothing arrived, and that is
        what to look at. Where an invoice is filed against a payment the invoice's date is used, so
        a bill paid late still counts in the month it was billed.
      </p>

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      <div className="bar">
        <label htmlFor="rcFrom">From</label>
        <input id="rcFrom" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label htmlFor="rcTo">To</label>
        <input id="rcTo" type="date" value={to} onChange={e => setTo(e.target.value)} />
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">All entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        <select value={view} onChange={e => setView(e.target.value)}
                title="A bill that moves card splits into two lines that each look full of holes. Condensed puts a vendor's accounts back together, still separated by entity.">
          <option value="condensed">Condensed by vendor</option>
          <option value="detail">By vendor and account</option>
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="gaps">Gaps first</option>
          <option value="amount">Largest first</option>
          <option value="vendor">By vendor</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
               title="Lines you have unticked stay in the database. This puts them back on screen.">
          <input type="checkbox" checked={showEx} style={{ width: 'auto' }}
                 onChange={e => setShowEx(e.target.checked)} />
          Show excluded
        </label>
      </div>

      {err && <div className="err">{err}</div>}
      {!raw && !err && <div className="loading">Reading…</div>}
      {raw && streams.length === 0 && (
        <div className="card"><div className="muted">Nothing recurring in that window.</div></div>
      )}

      {raw && streams.length > 0 && (
        <div className="card">
          <table className="grid-table">
            <thead>
              <tr>
                <th style={{ minWidth: 190 }}>Vendor</th>
                <th style={{ width: 110 }}>Entities</th>
                {months.map(m => (
                  <th key={m} className="num" style={{ width: 82 }}>{m.slice(2)}</th>
                ))}
                <th className="num" style={{ width: 100 }}>Total</th>
                <th style={{ width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {streams.map(s => {
                const mix = Object.keys(s.biz).sort()
                return [
                  <tr key={s.key} style={s.excluded ? { opacity: 0.5 } : undefined}>
                    <td>
                      <b>{s.vendor}</b>
                      {s.excluded && <span className="pill hold">excluded</span>}
                      {s.anchor && <span className="pill soft" title="Billed on a fixed day.">anchored</span>}
                      <div className="muted" style={{ fontSize: 11 }}>
                        {s.account}
                        {s.override && <> · {s.override}</>}
                      </div>
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {mix.map(b => <span key={b} className="pill">{b}</span>)}
                      {s.guessed > 0 && (
                        <div className="muted" title="Part of this was split by rule rather than by an invoice.">
                          ${money(s.guessed)} guessed
                        </div>
                      )}
                    </td>
                    {months.map(m => {
                      const c = s.cells[m]
                      return (
                        <td key={m} className={'money ' + (c ? '' : 'gap')}
                            title={c && c.n > 1 ? `${c.n} payments` : undefined}>
                          {c ? money(c.amt) : '·'}
                        </td>
                      )
                    })}
                    <td className="money"><b>{money(s.total)}</b></td>
                    <td style={{ fontSize: 11 }}>
                      {/* Excluding is per STREAM — this vendor on this account.
                          The whole-vendor form is separate and much blunter, so
                          it is offered under its own label rather than as a
                          second meaning for the same button. */}
                      <button disabled={busy === s.key} style={{ padding: '1px 7px', fontSize: 11 }}
                              title={s.excluded
                                ? 'Put this stream back in the report.'
                                : 'Take this vendor-and-account out of the report. It stays in the ledger.'}
                              onClick={() => act(s.key, () => rpc('set_recurring_exclusion', {
                                p_stream_key: s.key, p_vendor: s.vendor,
                                p_account: s.account, p_excluded: !s.excluded,
                              }))}>
                        {s.excluded ? 'include' : 'exclude'}
                      </button>{' '}
                      <button disabled={busy === s.key} style={{ padding: '1px 7px', fontSize: 11 }}
                              title="Say which entity this bill belongs to, rather than letting the split rule decide."
                              onClick={() => setSetting(setting === s.key ? null : s.key)}>
                        entity
                      </button>
                    </td>
                  </tr>,
                  setting === s.key && (
                    <tr key={s.key + '-e'} className="expand">
                      <td colSpan={months.length + 4}>
                        <div className="bar" style={{ margin: 0 }}>
                          <span style={{ fontSize: 12.5 }}>
                            {s.vendor} · {s.account} belongs to
                          </span>
                          {entities.map(b => (
                            <button key={b.code} disabled={busy === s.key}
                                    onClick={() => act(s.key, () => rpc('set_recurring_business', {
                                      p_stream_key: s.key, p_vendor: s.vendor,
                                      p_account: s.account, p_business: b.code,
                                    })).then(() => setSetting(null))}>
                              {b.code}
                            </button>
                          ))}
                          <span style={{ flex: 1 }} />
                          <button disabled={busy === s.key}
                                  title="Every stream for this vendor, in this entity, out of the report at once."
                                  onClick={() => act(s.key, () => rpc('set_recurring_exclusion_vendor', {
                                    p_vendor: s.vendor,
                                    p_business: Object.keys(s.biz).sort()[0] || null,
                                    p_excluded: true,
                                  })).then(() => setSetting(null))}>
                            Exclude the whole vendor
                          </button>
                        </div>
                        <p className="hint" style={{ margin: '4px 0 0' }}>
                          Overriding the entity changes only how this report reads. It does not
                          re-post anything — the ledger keeps whatever the entries actually say.
                        </p>
                      </td>
                    </tr>
                  ),
                ]
              })}
              <tr className="total">
                <td colSpan={2}>Total</td>
                {months.map(m => <td key={m} className="money">{money(colTotal(m))}</td>)}
                <td className="money">{money(grand)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
