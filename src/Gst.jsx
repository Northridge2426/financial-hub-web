import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money, today } from './format.js'

const num = v => Number(v) || 0
const signed = v => (num(v) < 0 ? '−$' : '$') + money(Math.abs(num(v)))

/**
 * GST remittance. Three reads: the remittance itself by entity, the accounts
 * behind it, and the filings already made.
 *
 * `gst_expected` is what the collected figure ought to be given the taxable
 * revenue; `gst_variance` is the gap. A variance is usually a sale coded to a
 * taxable account with no GST split off it, so it is worth more attention than
 * the headline number.
 */
export default function Gst() {
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState(today())
  const [scope, setScope] = useState('ALL')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [tick, setTick] = useState(0)          // forces a reload after a write

  useEffect(() => {
    setData(null); setErr('')
    Promise.all([
      rpc('gst_remittance', { p_from: from, p_to: to, p_scope: scope }),
      rpc('gst_remittance_accounts', { p_from: from, p_to: to, p_scope: scope }),
      rpc('gst_filing_list', { p_scope: scope }),
    ])
      .then(([summary, accounts, filings]) => setData({ summary, accounts, filings }))
      .catch(e => setErr(e.message))
  }, [from, to, scope, tick])

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
        GST collected against input tax credits, by entity, for the period. Businesses under one
        proprietor are added together — the filing is the proprietor's, not the business's.
      </p>

      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      <div className="bar">
        <label htmlFor="gsFrom">From</label>
        <input id="gsFrom" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label htmlFor="gsTo">To</label>
        <input id="gsTo" type="date" value={to} onChange={e => setTo(e.target.value)} />
        <select value={scope} onChange={e => setScope(e.target.value)}>
          <option value="ALL">All proprietors</option>
        </select>
      </div>

      {err && <div className="err">{err}</div>}
      {!data && !err && <div className="loading">Reading…</div>}

      {data && (() => {
        const { summary, accounts, filings } = data
        const sum = k => summary.reduce((a, r) => a + num(r[k]), 0)
        const variance = sum('gst_variance')

        return (
          <>
            <div className="grid" style={{ marginBottom: 14 }}>
              <div className="stat"><div className="n">${money(sum('rev_total'))}</div><div className="l">revenue</div></div>
              <div className="stat"><div className="n">${money(sum('gst_collected'))}</div><div className="l">GST collected</div></div>
              <div className="stat"><div className="n">${money(sum('itc'))}</div><div className="l">input tax credits</div></div>
              <div className="stat">
                <div className={'n ' + (sum('net_owing') > 0 ? 'neg' : 'pos')}>
                  {signed(sum('net_owing'))}
                </div>
                <div className="l">net owing</div>
              </div>
            </div>

            {Math.abs(variance) > 0.5 && (
              <div className="note warn">
                <b>GST collected is {signed(Math.abs(variance))} away from what the taxable revenue
                implies.</b> That usually means a sale was coded to a taxable account without GST
                being split off it — worth finding before filing, because the return is built from
                the collected figure, not the expected one.
              </div>
            )}

            <div className="card">
              <h2>By entity</h2>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 62 }}>Entity</th>
                    <th style={{ width: 110 }}>Proprietor</th>
                    <th className="num">Taxable</th>
                    <th className="num">Zero-rated</th>
                    <th className="num">Exempt</th>
                    <th className="num">Collected</th>
                    <th className="num">Expected</th>
                    <th className="num">ITC</th>
                    <th className="num">Net owing</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map(r => (
                    <tr key={r.code}>
                      <td><span className="pill">{r.business || r.code}</span></td>
                      <td className="muted" style={{ fontSize: 12 }}>{r.proprietor}</td>
                      <td className="money">${money(r.rev_taxable)}</td>
                      <td className="money">{num(r.rev_zero_rated) ? '$' + money(r.rev_zero_rated) : <span className="muted">—</span>}</td>
                      <td className="money">{num(r.rev_exempt) ? '$' + money(r.rev_exempt) : <span className="muted">—</span>}</td>
                      <td className="money">${money(r.gst_collected)}</td>
                      <td className={'money ' + (Math.abs(num(r.gst_variance)) > 0.5 ? 'due-soon' : 'muted')}>
                        ${money(r.gst_expected)}
                      </td>
                      <td className="money">${money(r.itc)}</td>
                      <td className="money"><b>{signed(r.net_owing)}</b></td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td colSpan={2}>Total</td>
                    <td className="money">${money(sum('rev_taxable'))}</td>
                    <td className="money">${money(sum('rev_zero_rated'))}</td>
                    <td className="money">${money(sum('rev_exempt'))}</td>
                    <td className="money">${money(sum('gst_collected'))}</td>
                    <td className="money">${money(sum('gst_expected'))}</td>
                    <td className="money">${money(sum('itc'))}</td>
                    <td className="money">{signed(sum('net_owing'))}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="card">
              <h2>The accounts behind it</h2>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 62 }}>Entity</th>
                    <th style={{ width: 80 }}>Number</th>
                    <th>Account</th>
                    <th style={{ width: 130 }}>GST status</th>
                    <th className="num" style={{ width: 60 }}>Lines</th>
                    <th className="num" style={{ width: 120 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((r, i) => (
                    <tr key={i}>
                      <td><span className="pill">{r.code}</span></td>
                      <td className="muted">{r.gl_number}</td>
                      <td>{r.gl_name}</td>
                      <td>
                        {/* The status decides whether an account's amounts go into
                            the return at all, so it is set here — next to the figure
                            it changes — rather than on a settings screen. */}
                        <select value={r.gst_status || ''} disabled={busy === r.gl_account_id}
                                style={{ fontSize: 12 }}
                                onChange={e => act(r.gl_account_id, () => rpc('set_gst_status', {
                                  p_account: r.gl_account_id, p_status: e.target.value,
                                }))}>
                          <option value="taxable">taxable</option>
                          <option value="exempt">exempt</option>
                          <option value="zero_rated">zero rated</option>
                          <option value="out_of_scope">out of scope</option>
                          {r.gst_status && !['taxable','exempt','zero_rated','out_of_scope'].includes(r.gst_status) && (
                            <option value={r.gst_status}>{r.gst_status}</option>
                          )}
                        </select>
                      </td>
                      <td className="money">{r.lines}</td>
                      <td className="money">{signed(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filings.length > 0 && (
              <div className="card">
                <h2>Filings already made</h2>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Proprietor</th>
                      <th style={{ width: 120 }}>Period</th>
                      <th style={{ width: 96 }}>Filed</th>
                      <th className="num">101 Sales</th>
                      <th className="num">105 Collected</th>
                      <th className="num">108 ITC</th>
                      <th className="num">Net</th>
                      <th style={{ width: 120 }}>Posted</th>
                      <th style={{ width: 80 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {filings.map(f => (
                      <tr key={f.id}>
                        <td>{f.proprietor}</td>
                        <td>{f.period}</td>
                        <td>{f.filed_on || <span className="muted">—</span>}</td>
                        <td className="money">${money(f.line_101)}</td>
                        <td className="money">${money(f.line_105)}</td>
                        <td className="money">${money(f.line_108)}</td>
                        <td className="money"><b>{signed(f.net)}</b></td>
                        <td>
                          {f.posted_entities === f.total_entities
                            ? <span className="pill soft">all {f.total_entities}</span>
                            : <span className="pill hold">{f.posted_entities} of {f.total_entities}</span>}
                        </td>
                        <td>
                          {f.posted_entities !== f.total_entities && (
                            <button disabled={busy === f.id} style={{ padding: '1px 8px', fontSize: 11 }}
                                    title="Raises the remittance payable in every entity that has not got one yet."
                                    onClick={() => act(f.id, () => rpc('post_gst_filing', { p_filing: f.id }))}>
                              {busy === f.id ? 'Posting…' : 'post it'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="hint" style={{ margin: '8px 0 0' }}>
                  A filing is posted per entity, because each one carries its own share of the
                  remittance. Anything short of all of them means the payable is understated
                  somewhere.
                </p>
              </div>
            )}
          </>
        )
      })()}
    </div>
  )
}
