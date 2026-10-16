import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money, today } from './format.js'
import { useEntities } from './useEntities.js'
import Section from './Section.jsx'
import DrillLines from './DrillLines.jsx'

/**
 * Cash flow — a port of the console's `cashflow` pane (runCashflow in
 * hub-live.html). Not a conventional statement of cash flows: there is no
 * operations / investing / financing. Cash is the bank, savings and till
 * accounts; every other account appears as its EFFECT on that cash.
 *
 * Opening and closing cash come from the BANK statements (bank_balance_at),
 * not the ledger. The report therefore does not balance by construction — the
 * gap between "where the ledger thinks the cash is" and what the bank says is
 * decomposed exactly by cash_flow_bridge into three named causes. If the
 * closing banner says the bridge does not close, that is a fault in the
 * decomposition, not rounding.
 *
 * cash_flow() returns three kinds of row — opening, movement, closing — and
 * they must be kept apart: summing them together is meaningless. The first web
 * version did exactly that.
 *
 * Which group an account falls in comes from v_cf_classification, where
 * gl_accounts.cf_bucket overrides the rule. Fix a misfiled account there.
 */

const ALL = '__ALL__'
const n = v => Number(v) || 0
const EPS = 0.004
const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`

/** Local YYYY-MM-DD for the first of the month `back` months before this one. */
function monthStart(back) {
  const d = new Date()
  const m = new Date(d.getFullYear(), d.getMonth() - back, 1)
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-01`
}
const SNAPS = [
  ['Year to date',  () => `${new Date().getFullYear()}-01-01`],
  ['This month',    () => monthStart(0)],
  ['Last 3 months', () => monthStart(2)],
]

/** The figure printed beside a fold's title, as the console's cfAmt does. */
const Amt = ({ v }) => <span className="cfamt">{money(v)}</span>

/**
 * A table whose rows open the entries behind their GL account in place.
 * One open row per table; clicking it again shuts it.
 */
function DrillTable({ head, rows, cols, from, to }) {
  const [open, setOpen] = useState(null)
  return (
    <table>
      <thead><tr>{head}</tr></thead>
      <tbody>
        {rows.map((r, i) => {
          const key = (r.gl_account_id || '') + ':' + i
          const gl = r.gl_account_id
          return [
            <tr key={key} className={gl ? 'drill' : ''}
                onClick={gl ? () => setOpen(open === key ? null : key) : undefined}>
              {cols(r)}
            </tr>,
            open === key && (
              <tr key={key + 'x'} className="expand">
                <td colSpan={99}><DrillLines gl={gl} from={from} to={to} includeOpening={false} /></td>
              </tr>
            ),
          ]
        })}
      </tbody>
    </table>
  )
}

/** Detail under a movement group, biggest first — the question a group answers
 *  is "what made this number", and that is almost always the top rows. */
function GroupLines({ rows, showBiz, from, to }) {
  const sorted = [...rows].sort((a, b) => Math.abs(n(b.amount)) - Math.abs(n(a.amount)))
  return (
    <DrillTable from={from} to={to} rows={sorted}
      head={<>
        {showBiz && <th style={{ width: '7%' }}>Entity</th>}
        <th style={{ width: '12%' }}>Account</th>
        <th>Name</th>
        <th className="num" style={{ width: '20%' }}>Effect on cash</th>
      </>}
      cols={r => <>
        {showBiz && <td className="muted">{r.business}</td>}
        <td className="muted">{r.number}</td>
        <td>
          {r.name}
          {r.is_override && <span className="muted" style={{ fontSize: 11.5 }}> (bucket set by hand)</span>}
        </td>
        <td className="money">{money(r.amount)}</td>
      </>} />
  )
}

/** Opening or closing cash per account, with the ledger's own figure beside it.
 *  Showing both is the point: where they disagree, the bridge says why. */
function CashTable({ rows, showBiz, from, to }) {
  if (!rows.length) return <div className="muted empty">No cash balance recorded.</div>
  const sorted = [...rows].sort((a, b) =>
    ((a.business || '') + (a.number || '')).localeCompare((b.business || '') + (b.number || '')))
  return (
    <DrillTable from={from} to={to} rows={sorted}
      head={<>
        {showBiz && <th style={{ width: '7%' }}>Entity</th>}
        <th style={{ width: '10%' }}>Account</th>
        <th>Name</th>
        <th className="num" style={{ width: '13%' }}>Per the bank</th>
        <th className="num" style={{ width: '13%' }}>Per the ledger</th>
        <th style={{ width: '26%' }}>Where the bank figure comes from</th>
      </>}
      cols={r => {
        const differs = Math.abs(n(r.amount) - n(r.ledger_amount)) > EPS
        return <>
          {showBiz && <td className="muted">{r.business}</td>}
          <td className="muted">{r.number}</td>
          <td>{r.name}</td>
          <td className="money">{money(r.amount)}</td>
          <td className={'money ' + (differs ? '' : 'muted')}>{money(r.ledger_amount)}</td>
          <td className="muted" style={{ fontSize: 11.5 }}>{r.basis || ''}</td>
        </>
      }} />
  )
}

function GroupFolds({ groups, prefix, showBiz, from, to }) {
  return groups.map(g => (
    <Section key={prefix + g.code}
             title={<>{g.label}<Amt v={g.total} /></>}
             count={plural(g.rows.length, 'account', 'accounts')}>
      <GroupLines rows={g.rows} showBiz={showBiz} from={from} to={to} />
    </Section>
  ))
}

export default function CashFlow() {
  const [biz, setBiz] = useState(ALL)
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`)
  const [to, setTo] = useState(today())
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [run, setRun] = useState(0)
  const entities = useEntities()

  useEffect(() => {
    if (!from || !to) return
    setData(null); setErr('')
    const args = { p_business: biz === ALL ? null : biz, p_from: from, p_to: to }
    Promise.all([
      rpc('cash_flow', args),
      rpc('cash_flow_bridge', args),
      rpc('cash_flow_unallocated', args),
    ])
      .then(([cf, br, un]) => setData({ cf, br, un, biz, from, to }))
      .catch(e => setErr(e.message))
  }, [biz, from, to, run])

  return (
    <div className="page">
      <div className="bar noprint">
        <select value={biz} onChange={e => setBiz(e.target.value)}>
          <option value={ALL}>Combined — all entities</option>
          {entities.map(b => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From" />
        <label>to</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To" />
        {SNAPS.map(([label, fn]) => (
          <button key={label} type="button" className="mini"
                  onClick={() => { setFrom(fn()); setTo(today()) }}>{label}</button>
        ))}
        <button type="button" className="mini" onClick={() => setRun(x => x + 1)}>Refresh</button>
        <button type="button" className="mini" onClick={() => window.print()}>Print / PDF</button>
      </div>

      {err && <div className="err">{err}</div>}
      {!data && !err && <div className="loading">Running…</div>}
      {data && <Report {...data} />}
    </div>
  )
}

function Report({ cf, br, un, biz, from, to }) {
  const all = biz === ALL
  const opening = cf.filter(r => r.kind === 'opening')
  const closing = cf.filter(r => r.kind === 'closing')
  const moves   = cf.filter(r => r.kind === 'movement')
  const sum = (rows, k) => rows.reduce((a, r) => a + n(r[k]), 0)
  const openTot  = sum(opening, 'amount')
  const closeTot = sum(closing, 'amount')

  const byCode = {}
  for (const r of moves) {
    const g = byCode[r.group_code] || (byCode[r.group_code] =
      { code: r.group_code, label: r.group_label, sort: n(r.group_sort), rows: [], total: 0 })
    g.rows.push(r); g.total += n(r.amount)
  }
  const groups = Object.values(byCode).sort((a, b) => a.sort - b.sort)
  // A group's side is decided by its sign this period, not by its nature: cards
  // run up are a source, cards paid down are a use.
  const sources = groups.filter(g => g.total > EPS)
  const uses    = groups.filter(g => g.total < -EPS)
  const flat    = groups.filter(g => Math.abs(g.total) <= EPS)
  const srcTot  = sources.reduce((a, g) => a + g.total, 0)
  const useTot  = uses.reduce((a, g) => a + g.total, 0)
  // Off every movement, not srcTot + useTot — a group netting under half a cent
  // is in neither list and the reconciliation must not lose it.
  const moveTot = sum(moves, 'amount')
  const ledgerLands = openTot + moveTot

  const bUnc = sum(br, 'uncoded'), bEls = sum(br, 'ledger_elsewhere'), bTim = sum(br, 'timing_diff')
  const bridge = closeTot - ledgerLands
  // bank close = bank open + ledger movement + uncoded − ledger-only + timing
  const off = Math.round((ledgerLands + bUnc - bEls + bTim - closeTot) * 100) / 100

  const brRows = br
    .filter(r => Math.abs(n(r.uncoded)) > EPS || Math.abs(n(r.ledger_elsewhere)) > EPS
              || Math.abs(n(r.timing_diff)) > EPS)
    .sort((a, b) => Math.abs(n(b.bank_move) - n(b.ledger_move)) - Math.abs(n(a.bank_move) - n(a.ledger_move)))

  // Uncoded lines on CARDS are not part of the bridge: coding them moves the
  // expense and the card balance together and leaves bank cash alone. in_bridge
  // marks exactly the subset the bridge counts, so the two cannot drift apart.
  const unTot   = sum(un, 'amount')
  const unCount = sum(un, 'n')
  const inBrN   = sum(un.filter(r => r.in_bridge), 'n')
  const unBy = {}
  for (const r of un) {
    const g = unBy[r.reason_code] || (unBy[r.reason_code] =
      { code: r.reason_code, label: r.reason_label, sort: n(r.reason_sort), rows: [], total: 0, n: 0 })
    g.rows.push(r); g.total += n(r.amount); g.n += n(r.n)
  }
  const unGroups = Object.values(unBy).sort((a, b) => a.sort - b.sort)

  return (
    <div className="cfrpt">
      <h2 className="rpt-title">{all ? 'Combined — all entities' : biz} — cash flow</h2>
      <div className="muted" style={{ marginBottom: 12, fontSize: 12 }}>{from} to {to}</div>

      <Section title={<>Opening cash, per the bank<Amt v={openTot} /></>}
               count={plural(opening.length, 'account', 'accounts')}>
        <CashTable rows={opening} showBiz={all} from={from} to={to} />
      </Section>

      <h3 className="cfhead">Where the money came from <span>{money(srcTot)}</span></h3>
      {sources.length
        ? <GroupFolds groups={sources} prefix="src" showBiz={all} from={from} to={to} />
        : <div className="muted empty">Nothing came in this period.</div>}

      <h3 className="cfhead">Where the money went <span>{money(useTot)}</span></h3>
      {uses.length
        ? <GroupFolds groups={uses} prefix="use" showBiz={all} from={from} to={to} />
        : <div className="muted empty">Nothing went out this period.</div>}

      {flat.length > 0 && (
        <Section title="Moved but netted to nothing" count={plural(flat.length, 'group', 'groups')}>
          <GroupFolds groups={flat} prefix="flat" showBiz={all} from={from} to={to} />
        </Section>
      )}

      <div className="note good" style={{ marginTop: 12 }}>
        Opening {money(openTot)}
        {moveTot ? ` plus ${money(srcTot)} in less ${money(Math.abs(useTot))} out` : ''}
        {' '}leaves <b>{money(ledgerLands)}</b> — which is where the ledger thinks the cash is.
        The bank says {money(closeTot)}.
      </div>

      <Section defaultOpen
               title={<>Bridge from the ledger to the bank<Amt v={bridge} /></>}
               count={plural(brRows.length, 'account differs', 'accounts differ')}>
        <table>
          <tbody>
            <tr><td>Bank lines in no entry</td>
                <td className="money" style={{ width: '20%' }}>{money(bUnc)}</td></tr>
            <tr><td>Ledger entries on that bank account that belong to none of its lines — manual
                    journals and entries routed in from elsewhere</td>
                <td className="money">{money(-bEls)}</td></tr>
            <tr><td>Timing and amount differences between the two date bases</td>
                <td className="money">{money(bTim)}</td></tr>
            <tr className="total"><td>Bridge</td><td className="money">{money(bridge)}</td></tr>
          </tbody>
        </table>
        <p className="hint" style={{ margin: '10px 0 6px' }}>Per account:</p>
        {brRows.length ? (
          <table>
            <thead>
              <tr>
                {all && <th style={{ width: '7%' }}>Entity</th>}
                <th>Account</th>
                <th className="num" style={{ width: '13%' }}>Bank moved</th>
                <th className="num" style={{ width: '13%' }}>Ledger moved</th>
                <th className="num" style={{ width: '13%' }}>In no entry</th>
                <th className="num" style={{ width: '15%' }}>Ledger only</th>
                <th className="num" style={{ width: '11%' }}>Timing</th>
              </tr>
            </thead>
            <tbody>
              {brRows.map((r, i) => (
                <tr key={i}>
                  {all && <td className="muted">{r.business}</td>}
                  <td>{r.account_name || r.name} <span className="muted" style={{ fontSize: 11.5 }}>{r.number}</span></td>
                  <td className="money">{money(r.bank_move)}</td>
                  <td className="money">{money(r.ledger_move)}</td>
                  <td className="money">{money(r.uncoded)}</td>
                  <td className="money">{money(-n(r.ledger_elsewhere))}</td>
                  <td className={'money ' + (Math.abs(n(r.timing_diff)) > EPS ? '' : 'muted')}>
                    {money(r.timing_diff)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="muted empty">The ledger matches the bank on every account.</div>}
      </Section>

      <Section title={<>Closing cash, per the bank<Amt v={closeTot} /></>}
               count={plural(closing.length, 'account', 'accounts')}>
        <CashTable rows={closing} showBiz={all} from={from} to={to} />
      </Section>

      <div className={'note ' + (off ? 'bad' : 'good')}>
        {off
          ? <>The bridge does not close — out by {money(off)}. The decomposition is meant to be
              exact, so this is a fault in it, not rounding.</>
          : <>{money(openTot)} opening + {money(moveTot)} through the ledger + {money(bridge)} bridged
              = {money(closeTot)} closing, which is what the bank statements say.</>}
      </div>

      {un.length > 0 && (
        <>
          <h3 className="cfhead">Not yet in the ledger <span>{money(unTot)}</span></h3>
          <p className="hint">
            {unCount} transactions in this period are in no entry at all. A transfer between two
            accounts counts as booked when either leg carries the entry, and a line linked to its
            Sage entry or to an adjustment counts too — so what is listed here is genuinely missing.{' '}
            <b>{inBrN} of them are on a bank account</b> and make up the {money(bUnc)} first line
            of the bridge above. The rest are on cards and lines of credit: booking those moves the
            expense and the card balance together and leaves bank cash alone, so they change the
            middle of this report but not its closing figure. Lines set aside as ignored are left
            out, because the bank balances leave them out too.
          </p>
          {unGroups.map(g => (
            <Section key={'un' + g.code}
                     title={<>{g.label}<Amt v={g.total} /></>}
                     count={plural(g.n, 'transaction', 'transactions')}>
              <table>
                <thead>
                  <tr>
                    {all && <th style={{ width: '7%' }}>Entity</th>}
                    <th>Account</th>
                    <th style={{ width: '14%' }}>Kind</th>
                    <th className="num" style={{ width: '9%' }}>Count</th>
                    <th className="num" style={{ width: '16%' }}>Net amount</th>
                    <th style={{ width: '14%' }}>In the bridge</th>
                  </tr>
                </thead>
                <tbody>
                  {[...g.rows].sort((a, b) => Math.abs(n(b.amount)) - Math.abs(n(a.amount))).map((r, i) => (
                    <tr key={i}>
                      {all && <td className="muted">{r.business}</td>}
                      <td>{r.account_name}</td>
                      <td className="muted">{r.account_kind}</td>
                      <td className="money">{r.n}</td>
                      <td className="money">{money(r.amount)}</td>
                      <td className="muted">{r.in_bridge ? 'yes' : 'no'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          ))}
        </>
      )}

      <p className="hint" style={{ marginTop: 12 }}>
        Cash means the chequing, savings and undeposited-till accounts. Opening and closing are
        taken from the bank statements — the nearest statement or year-opening anchor, walked
        forward or back over the transactions to the date shown, which is what the "where the bank
        figure comes from" column reports. Every other account appears as its effect on that cash,
        so an expense put on a card shows as a use and the card balance that funded it shows as a
        source; they cancel.{' '}
        {all && <>Combined is the six sets of books added together with nothing eliminated, and an
          account number is not unique across them, so each row carries its own entity.{' '}</>}
        A group sits under "came from" or "went" by its sign this period, so credit cards move
        sides depending on whether they were run up or paid down. Click any account row to read the
        entries behind it. If an account is in the wrong group, set <code>gl_accounts.cf_bucket</code> on it.
      </p>
    </div>
  )
}
