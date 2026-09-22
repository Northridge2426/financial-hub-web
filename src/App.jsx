import { useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import SignIn from './SignIn.jsx'
import Overview from './Overview.jsx'
import PaymentsDue from './PaymentsDue.jsx'
import PaymentPriority from './PaymentPriority.jsx'
import Payables from './Payables.jsx'
import Accounts from './Accounts.jsx'
import BalanceSheet from './BalanceSheet.jsx'
import IncomeStatement from './IncomeStatement.jsx'
import Subscriptions from './Subscriptions.jsx'
import Interest from './Interest.jsx'
import Revenue from './Revenue.jsx'
import GeneralJournal from './GeneralJournal.jsx'
import Vendors from './Vendors.jsx'
import Statements from './Statements.jsx'
import Actuals from './Actuals.jsx'
import CashFlow from './CashFlow.jsx'
import Gst from './Gst.jsx'
import Projects from './Projects.jsx'
import Reminders from './Reminders.jsx'
import Recurring from './Recurring.jsx'
import StatementsDue from './StatementsDue.jsx'
import BankVerification from './BankVerification.jsx'
import VsSage from './VsSage.jsx'
import Provisionals from './Provisionals.jsx'
import JournalEntry from './JournalEntry.jsx'
import LedgerRec from './LedgerRec.jsx'
import BankRecon from './BankRecon.jsx'

/** Pages, in the order the console lists them. Add one per build.
 *  Components, not elements — so a page mounts fresh when you switch to it
 *  and refetches, rather than showing figures read some time ago. */
const PAGES = [
  { key: 'overview', label: 'Overview', Component: Overview },
  { key: 'paydue', label: 'Payments due', Component: PaymentsDue },
  { key: 'payprio', label: 'Priority', Component: PaymentPriority },
  { key: 'payables', label: 'Payables', Component: Payables },
  { key: 'accounts', label: 'Accounts', Component: Accounts },
  { key: 'bsheet', label: 'Balance sheet', Component: BalanceSheet },
  { key: 'istmt', label: 'Income statement', Component: IncomeStatement },
  { key: 'subs', label: 'Subscriptions', Component: Subscriptions },
  { key: 'interest', label: 'Interest', Component: Interest },
  { key: 'revenue', label: 'Revenue', Component: Revenue },
  { key: 'vendors', label: 'Vendors', Component: Vendors },
  { key: 'gj', label: 'General journal', Component: GeneralJournal },
  { key: 'stmtdir', label: 'Statements', Component: Statements },
  { key: 'reports', label: 'Actuals', Component: Actuals },
  { key: 'cashflow', label: 'Cash flow', Component: CashFlow },
  { key: 'gst', label: 'GST', Component: Gst },
  { key: 'projects', label: 'Projects', Component: Projects },
  { key: 'reminders', label: 'Reminders', Component: Reminders },
  { key: 'recurring', label: 'Recurring', Component: Recurring },
  { key: 'statements', label: 'Statements due', Component: StatementsDue },
  { key: 'bankrec', label: 'Bank check', Component: BankVerification },
  { key: 'variance', label: 'Vs Sage', Component: VsSage },
  { key: 'prov', label: 'Provisionals', Component: Provisionals },
  { key: 'je', label: 'Journal entry', Component: JournalEntry },
  { key: 'ledgerrec', label: 'Ledger rec', Component: LedgerRec },
  { key: 'bankrecon', label: 'Bank rec', Component: BankRecon },
]

export default function App() {
  const [session, setSession] = useState(undefined)   // undefined = still checking
  const [page, setPage] = useState('overview')
  const [counts, setCounts] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // A cheap end-to-end proof that the signed-in path reaches the database:
  // if this number matches the console, auth, RLS and grants are all working.
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

  const current = PAGES.find(p => p.key === page) ?? PAGES[0]

  return (
    <div className="shell">
      <div className="topbar">
        <h1>Financial Hub</h1>
        {counts != null && <span className="pill">{counts} outstanding</span>}
        <span className="spacer" />
        <span className="who" title={`Built ${__BUILT_AT__} UTC`}>
          {session.user.email} · <span className="build">{__BUILD__}</span>
        </span>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>

      <nav className="tabs">
        {PAGES.map(p => (
          <a key={p.key} href="#" className={p.key === page ? 'on' : ''}
             onClick={e => { e.preventDefault(); setPage(p.key) }}>
            {p.label}
          </a>
        ))}
      </nav>

      <current.Component />
    </div>
  )
}
