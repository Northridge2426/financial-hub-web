import { useEffect, useMemo, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money, today } from './format.js'

const num = v => Number(v) || 0

/**
 * Ledger details — one account, line by line, with a running balance.
 *
 * Bank and card accounts go through `web_account_ledger`, a wrapper added for
 * this app: `account_ledger` is overloaded with `p_account` as both text and
 * uuid, and PostgREST resolves overloads by argument name, so it cannot choose
 * between them. General ledger accounts use `gl_account_ledger`, which is not
 * overloaded and takes a source — the hub's own postings, or Sage's.
 */
export default function Ledger() {
  const [kind, setKind] = useState('bank')
  const [accounts, setAccounts] = useState([])
  const [glAccounts, setGlAccounts] = useState([])
  const [acct, setAcct] = useState('')
  const [source, setSource] = useState('hub')
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('accounts').select('id,name').eq('active', true).order('name')
      .then(({ data }) => setAccounts(data || []))
    supabase.from('v_gl_accounts_with_activity')
      .select('id,business,number,name,lines').order('business').order('number')
      .then(({ data }) => setGlAccounts(data || []))
  }, [])

  // Switching kind invalidates the chosen account.
  useEffect(() => { setAcct(''); setRows(null) }, [kind])

  useEffect(() => {
    if (!acct) { setRows(null); return }
    setRows(null); setErr('')
    const call = kind === 'bank'
      ? rpc('web_account_ledger', { p_account_id: acct, p_from: from, p_to: to })
      : rpc('gl_account_ledger', { p_gl_account: acct, p_from: from, p_to: to, p_source: source })
    call.then(setRows).catch(e => setErr(e.message))
  }, [acct, kind, source, from, to])

  const list = kind === 'bank' ? accounts : glAccounts
  const picked = useMemo(() => list.find(a => a.id === acct), [list, acct])

  return (
    <div className="page">
      <div className="bar">
        <select value={kind} onChange={e => setKind(e.target.value)}>
          <option value="bank">Bank and card accounts</option>
          <option value="gl">General ledger accounts</option>
        </select>

        <select value={acct} onChange={e => setAcct(e.target.value)} style={{ minWidth: 280 }}>
          <option value="">Pick an account…</option>
          {kind === 'bank'
            ? accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)
            : glAccounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.business} · {a.number} — {a.name} ({a.lines})
                </option>
              ))}
        </select>

        {kind === 'gl' && (
          <select value={source} onChange={e => setSource(e.target.value)}>
            <option value="hub">Posted here</option>
            <option value="sage">Sage</option>
          </select>
        )}

        <label htmlFor="lgFrom">From</label>
        <input id="lgFrom" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label htmlFor="lgTo">To</label>
        <input id="lgTo" type="date" value={to} onChange={e => setTo(e.target.value)} />
      </div>

      {err && <div className="err">{err}</div>}
      {!acct && <div className="card"><div className="muted">Pick an account.</div></div>}
      {acct && !rows && !err && <div className="loading">Reading…</div>}
      {rows && rows.length === 0 && (
        <div className="card"><div className="muted">Nothing in this period.</div></div>
      )}

      {rows && rows.length > 0 && (
        <>
          <h2 className="rpt-title">
            {kind === 'bank' ? picked?.name : `${picked?.number} ${picked?.name}`}
          </h2>
          <div className="muted" style={{ marginBottom: 12, fontSize: 12 }}>
            {from} to {to} · {rows.length} line{rows.length === 1 ? '' : 's'}
            {kind === 'gl' && <> · {source === 'sage' ? 'as Sage has it' : 'as posted here'}</>}
          </div>

          <div className="card">
            {kind === 'bank' ? (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 96 }}>Date</th>
                    <th style={{ width: 90 }}>Ref</th>
                    <th>Description</th>
                    <th style={{ width: 150 }}>Merchant</th>
                    <th className="num" style={{ width: 110 }}>In</th>
                    <th className="num" style={{ width: 110 }}>Out</th>
                    <th className="num" style={{ width: 120 }}>Balance</th>
                    <th style={{ width: 120 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.txn_date}</td>
                      <td className="muted">{r.ref}</td>
                      <td>{r.description}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{r.merchant || ''}</td>
                      <td className="money pos">{num(r.inflow) ? money(r.inflow) : ''}</td>
                      <td className="money">{num(r.outflow) ? money(r.outflow) : ''}</td>
                      <td className="money"><b>{money(r.running)}</b></td>
                      <td style={{ fontSize: 11 }}>
                        {r.reviewed && <span className="pill soft">reviewed</span>}
                        {!r.has_entry && <span className="pill hold">no entry</span>}
                        {num(r.docs) > 0 && <span className="pill">{r.docs} doc{num(r.docs) === 1 ? '' : 's'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 96 }}>Date</th>
                    <th style={{ width: 90 }}>Ref</th>
                    <th style={{ width: 100 }}>Entry</th>
                    <th>Description</th>
                    <th style={{ width: 130 }}>Project</th>
                    <th className="num" style={{ width: 110 }}>Debit</th>
                    <th className="num" style={{ width: 110 }}>Credit</th>
                    <th className="num" style={{ width: 120 }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.line_id}>
                      <td>{r.entry_date}</td>
                      <td className="muted">{r.ref || ''}</td>
                      <td className="muted">{r.jno || ''}</td>
                      <td>
                        {r.description}
                        {r.reconciled && <span className="pill soft">reconciled</span>}
                        {num(r.docs) > 0 && <span className="pill">{r.docs} doc{num(r.docs) === 1 ? '' : 's'}</span>}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>{r.project || ''}</td>
                      <td className="money">{num(r.debit) ? money(r.debit) : ''}</td>
                      <td className="money">{num(r.credit) ? money(r.credit) : ''}</td>
                      <td className="money"><b>{money(r.running)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
