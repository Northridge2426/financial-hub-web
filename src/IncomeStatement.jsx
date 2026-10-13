import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { today } from './format.js'
import { useEntities } from './useEntities.js'
import { useReportGroups } from './useReportGroups.js'
import StatementTable from './StatementTable.jsx'

const ALL = '__ALL__'

export default function IncomeStatement() {
  const [biz, setBiz] = useState('')
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState(today())
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
      ? rpc('income_statement_combined', { p_from: from, p_to: to })
      : grp
        ? rpc('income_statement_group', { p_from: from, p_to: to, p_codes: grp.codes })
        : rpc('income_statement', { p_business: biz, p_from: from, p_to: to })
    call
      .then(d => setRows([...d].sort((a, b) =>
        (a.sort_order - b.sort_order) ||
        String(a.business || '').localeCompare(String(b.business || '')) ||
        String(a.number || '').localeCompare(String(b.number || '')))))
      .catch(e => setErr(e.message))
  }, [biz, from, to, groups])

  const grp = groups.find(g => g.key === biz)
  const all = biz === ALL
  const multi = all || !!grp
  const title = all ? 'Combined — all entities' : grp ? grp.label : biz
  const revenue = Number((rows || []).find(r => r.name === 'Total revenue')?.amount || 0)

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
        <label htmlFor="isFrom">From</label>
        <input id="isFrom" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label htmlFor="isTo">To</label>
        <input id="isTo" type="date" value={to} onChange={e => setTo(e.target.value)} />
      </div>

      {err && <div className="err">{err}</div>}
      {!biz && <div className="card"><div className="muted">Pick an entity.</div></div>}
      {biz && !rows && !err && <div className="loading">Running…</div>}

      {rows && (
        <>
          <h2 className="rpt-title">
            {title} — income statement
          </h2>
          <div className="muted" style={{ marginBottom: 12, fontSize: 12 }}>{from} to {to}</div>

          {revenue === 0 && (
            <div className="note bad">
              No revenue is booked for {all ? 'any entity' : grp ? 'these entities' : biz} in this period. Deposits are
              sitting in the clearing accounts — Square, Nayax, Stripe and EMT receivable — because
              the settlement reports that turn them into sales have not been entered. Expenses
              below are complete; the result is not.
            </div>
          )}

          <StatementTable rows={rows} sections={['Revenue', 'Expenses', 'Net']}
                          showBiz={multi} from={from} to={to} includeOpening={false} />

          {groupErr && (
            <p className="hint">Proprietor groups are unavailable — {groupErr}</p>
          )}

          {grp && (
            <p className="hint">
              {grp.label} is those sets of books added together, account by account — the
              same arithmetic as Combined, limited to {grp.codes.join(', ')}. Each row keeps
              its entity because an account number means a different account in each book;
              only the totals combine. Nothing is eliminated between them.
            </p>
          )}

          {all && (
            <p className="hint">
              Combined is the six sets of books added together, account by account — nothing is
              eliminated. Where one entity has paid another's cost the expense sits once, in the
              entity that bears it, so the total is not overstated; but a sale from one entity to
              another would be counted on both sides. An account number is not unique across the
              entities, which is why each row carries its own.
            </p>
          )}

          <p className="hint">
            Movement only — opening balances are excluded, so this is the year to date rather than
            the account's life.
          </p>
        </>
      )}
    </div>
  )
}
