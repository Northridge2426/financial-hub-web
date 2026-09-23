import { useEffect, useRef, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import SignIn from './SignIn.jsx'

import QuickReview from './QuickReview.jsx'
import AllOutstanding from './AllOutstanding.jsx'
import ReviewQueue from './ReviewQueue.jsx'
import Invoices from './Invoices.jsx'
import Transfers from './Transfers.jsx'

import Overview from './Overview.jsx'
import PaymentsDue from './PaymentsDue.jsx'
import PaymentPriority from './PaymentPriority.jsx'
import Recurring from './Recurring.jsx'
import Provisionals from './Provisionals.jsx'

import Payables from './Payables.jsx'
import Vendors from './Vendors.jsx'

import Ledger from './Ledger.jsx'
import LedgerRec from './LedgerRec.jsx'
import GeneralJournal from './GeneralJournal.jsx'
import JournalEntry from './JournalEntry.jsx'
import Accounts from './Accounts.jsx'

import Actuals from './Actuals.jsx'
import BalanceSheet from './BalanceSheet.jsx'
import IncomeStatement from './IncomeStatement.jsx'
import CashFlow from './CashFlow.jsx'
import Subscriptions from './Subscriptions.jsx'
import Gst from './Gst.jsx'
import Revenue from './Revenue.jsx'
import Interest from './Interest.jsx'
import Projects from './Projects.jsx'

import Reminders from './Reminders.jsx'
import VsSage from './VsSage.jsx'

import BankVerification from './BankVerification.jsx'
import BankRecon from './BankRecon.jsx'
import StatementsDue from './StatementsDue.jsx'
import Statements from './Statements.jsx'

/**
 * The console's own menus, in the console's own order, with the console's own
 * labels — taken from the tab bar in hub-live.html. Somebody who knows where a
 * page lives there should not have to learn a second arrangement here.
 *
 * `pages: null` means a flat tab rather than a menu, which is how Reminders and
 * Vs Sage behave in the console.
 *
 * Queues 1 and 3 have their own panes, as they do in the console — booking an
 * invoice and pairing a transfer are different jobs from coding an expense, and
 * `web_review_queue` returns nothing for those kinds for exactly that reason.
 * The rest share `ReviewQueue` with its detail editor.
 *
 * Queues 6 and 8 still fall through to ReviewQueue, which says so rather than
 * showing a wrong list.
 */
const MENUS = [
  { key: 'rev', label: 'Review', pages: [
    { key: 'quick',    label: '0 · Quick review',                  Component: QuickReview },
    { key: 'invoices', label: '1 · Allocate invoices',             Component: Invoices },
    { key: 'docs',     label: '2 · Assign receipts to invoices',   Component: () => <ReviewQueue kind="docs" /> },
    { key: 'hold',     label: '3 · Transfers and payments',        Component: Transfers },
    { key: 'plain',    label: '4 · Allocate expenses',             Component: () => <ReviewQueue kind="plain" /> },
    { key: 'apwait',   label: '5 · Waiting on documents',          Component: () => <ReviewQueue kind="apwait" /> },
    { key: 'docpair',  label: '6 · Document matching',             Component: () => <ReviewQueue kind="docpair" /> },
    { key: 'reopened', label: '7 · Documents arrived after review', Component: () => <ReviewQueue kind="reopened" /> },
    { key: 'stmtrev',  label: '8 · Statement only — review',       Component: () => <ReviewQueue kind="stmtrev" /> },
    { key: 'reviewed', label: '9 · Reviewed — reopen one',         Component: () => <ReviewQueue kind="reviewed" /> },
    { key: 'allout',   label: '★ All outstanding — everything uncoded', Component: AllOutstanding },
  ]},
  { key: 'ov', label: 'Financial overview', pages: [
    { key: 'overview',  label: 'Overview',                   Component: Overview },
    { key: 'paydue',    label: 'Payments due — next 30 days', Component: PaymentsDue },
    { key: 'payprio',   label: 'Payment prioritisation',     Component: PaymentPriority },
    { key: 'recurring', label: 'Recurring payments',         Component: Recurring },
    { key: 'prov',      label: 'Provisional entries',        Component: Provisionals },
  ]},
  { key: 'ap', label: 'Payables', pages: [
    { key: 'payables', label: 'Outstanding payables', Component: Payables },
    { key: 'vendors',  label: 'Vendor reports',       Component: Vendors },
  ]},
  { key: 'lg', label: 'Ledger', pages: [
    { key: 'ledger',    label: 'Ledger details',        Component: Ledger },
    { key: 'ledgerrec', label: 'Ledger reconciliation', Component: LedgerRec },
    { key: 'gj',        label: 'General journal',       Component: GeneralJournal },
    { key: 'je',        label: 'Journal entry',         Component: JournalEntry },
    { key: 'accounts',  label: 'Accounts',              Component: Accounts },
  ]},
  { key: 'rp', label: 'Reports', pages: [
    { key: 'reports',  label: 'Actuals by account', Component: Actuals },
    { key: 'bsheet',   label: 'Balance sheet',      Component: BalanceSheet },
    { key: 'istmt',    label: 'Income statement',   Component: IncomeStatement },
    { key: 'cashflow', label: 'Cash flow',          Component: CashFlow },
    { key: 'subs',     label: 'Subscriptions',      Component: Subscriptions },
    { key: 'gst',      label: 'GST remittance',     Component: Gst },
    { key: 'revenue',  label: 'Revenue',            Component: Revenue },
    { key: 'interest', label: 'Interest',           Component: Interest },
    { key: 'projects', label: 'Projects',           Component: Projects },
  ]},
  { key: 'reminders', label: 'Reminders', pages: null, Component: Reminders },
  { key: 'variance',  label: 'Vs Sage',   pages: null, Component: VsSage },
  { key: 'bank', label: 'Bank', pages: [
    { key: 'bankrec',   label: 'Bank balance verification', Component: BankVerification },
    { key: 'bankrecon', label: 'Bank reconciliation',       Component: BankRecon },
    { key: 'statements', label: 'Statements Due',           Component: StatementsDue },
    { key: 'stmtdir',   label: 'Statements',                Component: Statements },
  ]},
]

const ALL = MENUS.flatMap(m => m.pages ? m.pages.map(p => ({ ...p, menu: m })) : [{
  key: m.key, label: m.label, Component: m.Component, menu: m,
}])

const find = key => ALL.find(p => p.key === key) || ALL[0]

/** Remember where you were. localStorage can be empty or throw, so guard it. */
const remembered = () => {
  try { return localStorage.getItem('hub.page') || 'overview' } catch { return 'overview' }
}

export default function App() {
  const [session, setSession] = useState(undefined)   // undefined = still checking
  const [pageKey, setPageKey] = useState(remembered)
  const [openMenu, setOpenMenu] = useState(null)
  const [counts, setCounts] = useState(null)
  const [countErr, setCountErr] = useState('')
  const navRef = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    try { localStorage.setItem('hub.page', pageKey) } catch { /* not important */ }
  }, [pageKey])

  // Close an open menu on a click anywhere else, or on Escape.
  useEffect(() => {
    if (!openMenu) return
    const away = e => { if (navRef.current && !navRef.current.contains(e.target)) setOpenMenu(null) }
    const esc = e => { if (e.key === 'Escape') setOpenMenu(null) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [openMenu])

  // web_queue_counts() wraps queue_counts(), which is the canonical count for
  // every review queue — the same function the queue itself is filtered by, so
  // a badge can never disagree with what opening it shows. The wrapper exists
  // because the raw one times out for a signed-in user: 8s cap, RLS re-checked
  // per row. The error is SHOWN rather than swallowed — silently missing
  // badges is how this went unnoticed for a whole push.
  // queue_counts() is the canonical count for every review queue — the same
  // function the queue itself is filtered by, so a badge can never disagree
  // with what opening it shows. Refetched on each page change so the numbers
  // fall as you work, rather than going stale until a reload.
  useEffect(() => {
    if (!session) return
    rpc('web_queue_counts')
      .then(r => setCounts(Object.fromEntries(r.map(x => [x.k, Number(x.n) || 0]))))
      .then(() => setCountErr(''))
      .catch(e => { setCounts(null); setCountErr(e.message) })
  }, [session, pageKey])

  if (session === undefined) {
    return <div className="page"><div className="loading">Checking your session…</div></div>
  }
  if (!session) return <SignIn />

  const current = find(pageKey)

  const pick = key => { setPageKey(key); setOpenMenu(null) }

  return (
    <div className="shell">
      <div className="topbar">
        <h1>Financial Hub</h1>
        {counts?.allout != null && <span className="pill">{counts.allout} outstanding</span>}
        {countErr && (
          <span className="pill bad" title={'queue_counts: ' + countErr}>counts unavailable</span>
        )}
        <span className="spacer" />
        <span className="who">{session.user.email}</span>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>

      <nav className="tabs" ref={navRef}>
        {MENUS.map(m => {
          const active = current.menu.key === m.key
          if (!m.pages) {
            return (
              <a key={m.key} href="#" className={active ? 'on' : ''}
                 onClick={e => { e.preventDefault(); pick(m.key) }}>
                {m.label}
              </a>
            )
          }
          return (
            <span key={m.key} className="menuwrap">
              <a href="#" className={active ? 'on' : ''}
                 onClick={e => {
                   e.preventDefault()
                   setOpenMenu(openMenu === m.key ? null : m.key)
                 }}>
                {m.label} <span className="caret">▾</span>
              </a>
              {openMenu === m.key && (
                <div className="menu">
                  {m.pages.map(p => {
                    const n = counts?.[p.key]
                    return (
                      <div key={p.key}
                           className={'mi' + (p.key === current.key ? ' on' : '')}
                           onClick={() => pick(p.key)}>
                        {p.label}
                        {n != null && (
                          <span className={'mic' + (n === 0 ? ' zero' : '')}>{n}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </span>
          )
        })}
        <span className="spacer" />
        <span className="build" title={`Built ${__BUILT_AT__} UTC`}>{__BUILD__}</span>
      </nav>

      <div className="crumb">{current.label}</div>

      <current.Component />
    </div>
  )
}
