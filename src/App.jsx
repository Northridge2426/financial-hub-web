import { useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import SignIn from './SignIn.jsx'
import Overview from './Overview.jsx'
import PaymentsDue from './PaymentsDue.jsx'

/** Pages, in the order the console lists them. Add one per build.
 *  Components, not elements — so a page mounts fresh when you switch to it
 *  and refetches, rather than showing figures read some time ago. */
const PAGES = [
  { key: 'overview', label: 'Overview', Component: Overview },
  { key: 'paydue', label: 'Payments due', Component: PaymentsDue },
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
        <span className="who">{session.user.email}</span>
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
