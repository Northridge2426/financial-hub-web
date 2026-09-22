import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money, today } from './format.js'
import { useEntities } from './useEntities.js'
import StatementTable from './StatementTable.jsx'

const ALL = '__ALL__'

export default function BalanceSheet() {
  const [biz, setBiz] = useState('')
  const [asOf, setAsOf] = useState(today())
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const entities = useEntities()

  useEffect(() => {
    if (!biz) { setRows(null); return }
    setRows(null); setErr('')
    const all = biz === ALL
    const call = all
      ? rpc('balance_sheet_combined', { p_as_of: asOf })
      : rpc('balance_sheet', { p_business: biz, p_as_of: asOf })
    call
      // The functions return sort_order; the console sorts in SQL, so we do the
      // same here rather than trusting the order rows happen to arrive in.
      .then(d => setRows([...d].sort((a, b) =>
        (a.sort_order - b.sort_order) ||
        String(a.business || '').localeCompare(String(b.business || '')) ||
        String(a.number || '').localeCompare(String(b.number || '')))))
      .catch(e => setErr(e.message))
  }, [biz, asOf])

  const all = biz === ALL
  const totalOf = name => Number((rows || []).find(r => r.name === name)?.amount || 0)
  const a = totalOf('Total assets'), l = totalOf('Total liabilities'), e = totalOf('Total equity')
  const off = Math.round((a - l - e) * 100) / 100

  return (
    <div className="page">
      <div className="bar">
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">Pick an entity…</option>
          <option value={ALL}>Combined — all entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
        </select>
        <label htmlFor="bsAsOf">As at</label>
        <input id="bsAsOf" type="date" value={asOf} onChange={e => setAsOf(e.target.value)} />
      </div>

      {err && <div className="err">{err}</div>}
      {!biz && <div className="card"><div className="muted">Pick an entity.</div></div>}
      {biz && !rows && !err && <div className="loading">Running…</div>}

      {rows && (
        <>
          <h2 className="rpt-title">
            {all ? 'Combined — all entities' : biz} — balance sheet
          </h2>
          <div className="muted" style={{ marginBottom: 12, fontSize: 12 }}>as at {asOf}</div>

          <StatementTable rows={rows} sections={['Assets', 'Liabilities', 'Equity']}
                          showBiz={all} from="2026-01-01" to={asOf} includeOpening />

          <div className={'note ' + (off ? 'bad' : 'good')}>
            {off
              ? `Assets less liabilities and equity is out by ${money(off)}.`
              : `Assets ${money(a)} = liabilities ${money(l)} + equity ${money(e)}.`}
          </div>

          {all && (
            <p className="hint">
              Combined is the six sets of books added together, account by account — nothing is
              eliminated. The amounts each entity owes the others are still in here on both sides,
              so the related-party accounts (BRA 2140, FSK 2140, CRY 2140, BMS 2135, PER 2500)
              largely cancel but are shown rather than netted. An account number is not unique
              across the entities, which is why each row carries its own.
            </p>
          )}

          <p className="hint">
            Opening balances are the 2025 closing trial balances, posted into the ledger as entries
            dated 1 January 2026. The prior year's profit is closed into <b>3560 Retained earnings
            — previous year</b>, which is why 3560 here is larger than the figure on the 2025 trial
            balance.
          </p>
        </>
      )}
    </div>
  )
}
