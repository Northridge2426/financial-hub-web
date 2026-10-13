import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money, today } from './format.js'
import { useEntities } from './useEntities.js'
import { useReportGroups } from './useReportGroups.js'
import StatementTable from './StatementTable.jsx'

const ALL = '__ALL__'

export default function BalanceSheet() {
  const [biz, setBiz] = useState('')
  const [asOf, setAsOf] = useState(today())
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const entities = useEntities()
  const { groups, groupErr } = useReportGroups()

  useEffect(() => {
    if (!biz) { setRows(null); return }
    setRows(null); setErr('')
    const all = biz === ALL
    const grp = groups.find(g => g.key === biz)
    if (biz.startsWith('grp:') && !grp) return        // groups still loading
    const call = all
      ? rpc('balance_sheet_combined', { p_as_of: asOf })
      : grp
        ? rpc('balance_sheet_group', { p_as_of: asOf, p_codes: grp.codes })
        : rpc('balance_sheet', { p_business: biz, p_as_of: asOf })
    call
      // The functions return sort_order; the console sorts in SQL, so we do the
      // same here rather than trusting the order rows happen to arrive in.
      .then(d => setRows([...d].sort((a, b) =>
        (a.sort_order - b.sort_order) ||
        String(a.business || '').localeCompare(String(b.business || '')) ||
        String(a.number || '').localeCompare(String(b.number || '')))))
      .catch(e => setErr(e.message))
  }, [biz, asOf, groups])

  const grp = groups.find(g => g.key === biz)
  const all = biz === ALL
  const multi = all || !!grp
  const title = all ? 'Combined — all entities' : grp ? grp.label : biz
  const totalOf = name => Number((rows || []).find(r => r.name === name)?.amount || 0)
  const a = totalOf('Total assets'), l = totalOf('Total liabilities'), e = totalOf('Total equity')
  const off = Math.round((a - l - e) * 100) / 100

  return (
    <div className="page">
      <div className="bar">
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">Pick an entity…</option>
          <option value={ALL}>Combined — all entities</option>
          {groups.length > 0 && (
            <optgroup label="By proprietor">
              {groups.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </optgroup>
          )}
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
            {title} — balance sheet
          </h2>
          <div className="muted" style={{ marginBottom: 12, fontSize: 12 }}>as at {asOf}</div>

          <StatementTable rows={rows} sections={['Assets', 'Liabilities', 'Equity']}
                          showBiz={multi} from="2026-01-01" to={asOf} includeOpening />

          <div className={'note ' + (off ? 'bad' : 'good')}>
            {off
              ? `Assets less liabilities and equity is out by ${money(off)}.`
              : `Assets ${money(a)} = liabilities ${money(l)} + equity ${money(e)}.`}
          </div>

          {groupErr && (
            <p className="hint">Proprietor groups are unavailable — {groupErr}</p>
          )}

          {grp && (
            <p className="hint">
              {grp.label} is those sets of books added together, account by account, limited to{' '}
              {grp.codes.join(', ')}. Nothing is eliminated: what these entities owe each other
              appears on both sides, and what they owe entities outside the group (the other
              proprietor's books) stays as a real balance. Each row keeps its entity because an
              account number means a different account in each book.
            </p>
          )}

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
