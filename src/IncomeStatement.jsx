import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { today } from './format.js'
import { useEntities } from './useEntities.js'
import StatementTable from './StatementTable.jsx'

const ALL = '__ALL__'

export default function IncomeStatement() {
  const [biz, setBiz] = useState('')
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const entities = useEntities()

  useEffect(() => {
    if (!biz) { setRows(null); return }
    setRows(null); setErr('')
    const all = biz === ALL
    const call = all
      ? rpc('income_statement_combined', { p_from: from, p_to: to })
      : rpc('income_statement', { p_business: biz, p_from: from, p_to: to })
    call
      .then(d => setRows([...d].sort((a, b) =>
        (a.sort_order - b.sort_order) ||
        String(a.business || '').localeCompare(String(b.business || '')) ||
        String(a.number || '').localeCompare(String(b.number || '')))))
      .catch(e => setErr(e.message))
  }, [biz, from, to])

  const all = biz === ALL
  const revenue = Number((rows || []).find(r => r.name === 'Total revenue')?.amount || 0)

  return (
    <div className="page">
      <div className="bar">
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">Pick an entity…</option>
          <option value={ALL}>Combined — all entities</option>
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
            {all ? 'Combined — all entities' : biz} — income statement
          </h2>
          <div className="muted" style={{ marginBottom: 12, fontSize: 12 }}>{from} to {to}</div>

          {revenue === 0 && (
            <div className="note bad">
              No revenue is booked for {all ? 'any entity' : biz} in this period. Deposits are
              sitting in the clearing accounts — Square, Nayax, Stripe and EMT receivable — because
              the settlement reports that turn them into sales have not been entered. Expenses
              below are complete; the result is not.
            </div>
          )}

          <StatementTable rows={rows} sections={['Revenue', 'Expenses', 'Net']}
                          showBiz={all} from={from} to={to} includeOpening={false} />

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
