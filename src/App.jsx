import { useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import SignIn from './SignIn.jsx'

import Overview from './Overview.jsx'
import PaymentsDue from './PaymentsDue.jsx'
import PaymentPriority from './PaymentPriority.jsx'
import Provisionals from './Provisionals.jsx'
import Reminders from './Reminders.jsx'

import Payables from './Payables.jsx'
import Vendors from './Vendors.jsx'
import Recurring from './Recurring.jsx'
import Subscriptions from './Subscriptions.jsx'

import Ledger from './Ledger.jsx'
import GeneralJournal from './GeneralJournal.jsx'
import JournalEntry from './JournalEntry.jsx'
import LedgerRec from './LedgerRec.jsx'
import Accounts from './Accounts.jsx'

import StatementsDue from './StatementsDue.jsx'
import Statements from './Statements.jsx'
import BankVerification from './BankVerification.jsx'
import BankRecon from './BankRecon.jsx'

import BalanceSheet from './BalanceSheet.jsx'
import IncomeStatement from './IncomeStatement.jsx'
import CashFlow from './CashFlow.jsx'
import Actuals from './Actuals.jsx'
import Revenue from './Revenue.jsx'
import Interest from './Interest.jsx'
import Gst from './Gst.jsx'
import Projects from './Projects.jsx'
import VsSage from './VsSage.jsx'

/**
 * 27 pages will not fit in one row of tabs, so they are grouped: pick a group,
 * then a page within it. Components rather than elements, so a page mounts
 * fresh when you switch to it and refetches instead of showing figures read
 * some time ago.
 */
const GROUPS = [
  { key: 'daily', label: 'Daily', pages: [
    { key: 'overview', label: 'Overview', Component: Overview },
    { key: 'paydue', label: 'Payments due', Component: PaymentsDue },
    { key: 'payprio', label: 'Priority', Component: PaymentPriority },
    { key: 'prov', label: 'Provisionals', Component: Provisionals },
    { key: 'reminders', label: 'Reminders', Component: Reminders },
  ]},
  { key: 'payables', label: 'Payables', pages: [
    { key: 'payables', label: 'Outstanding', Component: Payables },
    { key: 'vendors', label: 'Vendors', Component: Vendors },
    { key: 'recurring', label: 'Recurring', Component: Recurring },
    { key: 'subs', label: 'Subscriptions', Component: Subscriptions },
  ]},
  { key: 'books', label: 'The books', pages: [
    { key: 'ledger', label: 'Ledger details', Component: Ledger },
    { key: 'gj', label: 'General journal', Component: GeneralJournal },
    { key: 'je', label: 'Journal entry', Component: JournalEntry },
    { key: 'ledgerrec', label: 'Ledger rec', Component: LedgerRec },
    { key: 'accounts', label: 'Accounts', Component: Accounts },
  ]},
  { key: 'statements', label: 'Statements', pages: [
    { key: 'statements', label: 'Due', Component: StatementsDue },
    { key: 'stmtdir', label: 'Filed', Component: Statements },
    { key: 'bankrec', label: 'Balance check', Component: BankVerification },
    { key: 'bankrecon', label: 'Reconcile', Component: BankRecon },
  ]},
  { key: 'reports', label: 'Reports', pages: [
    { key: 'bsheet', label: 'Balance sheet', Component: BalanceSheet },
    { key: 'istmt', label: 'Income statement', Component: IncomeStatement },
    { key: 'cashflow', label: 'Cash flow', Component: CashFlow },
    { key: 'reports', label: 'Actuals', Component: Actuals },
    { key: 'revenue', label: 'Revenue', Component: Revenue },
    { key: 'interest', label: 'Interest', Component: Interest },
    { key: 'gst', label: 'GST', Component: Gst },
    { key: 'projects', label: 'Projects', Component: Projects },
    { key: 'variance', label: 'Vs Sage', Component: VsSage },
  ]},
]

const findPage = key => {
  for (const g of GROUPS) {
    const p = g.pages.find(x => x.key === key)
    if (p) return { group: g, page: p }
  }
  return { group: GROUPS[0], page: GROUPS[0].pages[0] }
}

/** Remember where you were. localStorage is per-browser and can be empty or
 *  throw in some contexts, so every touch is guarded. */
const remembered = () => {
  try { return localStorage.getItem('hub.page') || 'overview' } catch { return 'overview' }
}

export default function App() {
  const [session, setSession] = useState(undefined)   // undefined = still checking
  const [pageKey, setPageKey] = useState(remembered)
  const [counts, setCounts] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    try { localStorage.setItem('hub.page', pageKey) } catch { /* not important */ }
  }, [pageKey])

  // A cheap end-to-end proof that the signed-in path reaches the database.
  useEffect(() => {
    if (!session) return
    rpc('queue_counts')
      .then(r => setCounts(r.find(x => x.k === 'allout')?.n ?? null))
      .catch(() => setCounts(null))
  }, [session])

  if (session === undefined) {
    return <div className="page"><div className="loading">Checking your session…</div></div>
  }
  if (!session) return <SignIn />

  const { group, page } = findPage(pageKey)

  return (
    <div className="shell">
      <div className="topbar">
        <h1>Financial Hub</h1>
        {counts != null && <span className="pill">{counts} outstanding</span>}
        <span className="spacer" />
        <span className="who">{session.user.email}</span>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>

      <nav className="tabs groups">
        {GROUPS.map(g => (
          <a key={g.key} href="#" className={g.key === group.key ? 'on' : ''}
             onClick={e => { e.preventDefault(); setPageKey(g.pages[0].key) }}>
            {g.label}
          </a>
        ))}
        <span className="spacer" />
        <span className="build" title={`Built ${__BUILT_AT__} UTC`}>{__BUILD__}</span>
      </nav>

      <nav className="tabs sub">
        {group.pages.map(p => (
          <a key={p.key} href="#" className={p.key === page.key ? 'on' : ''}
             onClick={e => { e.preventDefault(); setPageKey(p.key) }}>
            {p.label}
          </a>
        ))}
      </nav>

      <page.Component />
    </div>
  )
}
