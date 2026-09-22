import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { money } from './format.js'
import { useEntities } from './useEntities.js'

const num = v => Number(v) || 0
const signed = v => (num(v) < 0 ? '−$' : '$') + money(Math.abs(num(v)))

/**
 * Vs Sage — where this ledger and the Sage journal disagree, account by account.
 *
 * Sage's figures are debit and credit columns, so the comparison is on the NET
 * of each side. A variance is not automatically an error here: it can equally
 * mean Sage has an entry that was never brought across.
 */
export default function VsSage() {
  const [biz, setBiz] = useState('')
  const [limit, setLimit] = useState(60)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const entities = useEntities()

  useEffect(() => {
    (async () => {
      setData(null); setErr('')
      try {
        let det = supabase.from('v_ledger_variance')
          .select('business,account,account_name,sage_debit,sage_credit,hub_debit,hub_credit,variance',
                  { count: 'exact' })
          .or('variance.gt.0.005,variance.lt.-0.005')
        if (biz) det = det.eq('business', biz)

        const [sum, detail] = await Promise.all([
          supabase.from('v_ledger_variance_summary')
            .select('business,in_sage,accounts_differing,hub_higher,sage_higher,sage_lines,hub_lines,status')
            .order('in_sage', { ascending: false }).order('business'),
          det.order('variance', { ascending: false }).limit(limit),
        ])
        if (sum.error) throw new Error(sum.error.message)
        if (detail.error) throw new Error(detail.error.message)
        setData({ sum: sum.data || [], det: detail.data || [], total: detail.count ?? 0 })
      } catch (e) { setErr(e.message) }
    })()
  }, [biz, limit])

  if (err) return <div className="page"><div className="err">{err}</div></div>
  if (!data) return <div className="page"><div className="loading">Comparing…</div></div>

  const { sum, det, total } = data

  return (
    <div className="page">
      <p className="hint">
        Where this ledger and the Sage journal disagree. A variance is not automatically an error —
        it can equally mean Sage holds an entry that was never brought across.
      </p>

      <div className="bar">
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value="">All entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        <select value={limit} onChange={e => setLimit(Number(e.target.value))}>
          <option value={60}>Worst 60</option>
          <option value={200}>Worst 200</option>
          <option value={1000}>Everything</option>
        </select>
        <span className="muted" style={{ fontSize: 12 }}>
          {Math.min(det.length, total)} of {total} accounts differ
        </span>
      </div>

      <div className="card">
        <h2>By entity</h2>
        <table>
          <thead>
            <tr>
              <th>Entity</th>
              <th className="num" style={{ width: 130 }}>Accounts differing</th>
              <th className="num" style={{ width: 110 }}>Sage lines</th>
              <th className="num" style={{ width: 130 }}>Recorded here</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sum.map(r => (
              <tr key={r.business}>
                <td><b>{r.business}</b></td>
                <td className={'money ' + (num(r.accounts_differing) ? 'warn' : 'pos')}>
                  {r.accounts_differing}
                </td>
                <td className="money">{r.sage_lines}</td>
                <td className="money">{r.hub_lines}</td>
                <td className="muted" style={{ fontSize: 12 }}>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>By account</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: 62 }}>Entity</th>
              <th style={{ width: 90 }}>Account</th>
              <th>Name</th>
              <th className="num" style={{ width: 120 }}>Sage net</th>
              <th className="num" style={{ width: 120 }}>Here</th>
              <th className="num" style={{ width: 120 }}>Variance</th>
            </tr>
          </thead>
          <tbody>
            {det.length === 0 && (
              <tr><td colSpan={6} className="muted">Everything agrees.</td></tr>
            )}
            {det.map((r, i) => {
              const sageNet = num(r.sage_debit) - num(r.sage_credit)
              const hubNet = num(r.hub_debit) - num(r.hub_credit)
              return (
                <tr key={i}>
                  <td><span className="pill">{r.business}</span></td>
                  <td className="muted">{r.account}</td>
                  <td>{r.account_name}</td>
                  <td className="money">{signed(sageNet)}</td>
                  <td className="money">{signed(hubNet)}</td>
                  <td className="money due-soon"><b>{signed(r.variance)}</b></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
