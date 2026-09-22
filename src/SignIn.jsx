import { useState } from 'react'
import { supabase } from './supabase.js'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    // On success the auth listener in App swaps this screen out, so there is
    // nothing to do here but surface a failure.
    if (error) { setErr(error.message); setBusy(false) }
  }

  return (
    <div className="signin">
      <form onSubmit={submit}>
        <h1>Financial Hub</h1>
        <p className="hint">Six sets of books. Sign in to continue.</p>

        {err && <div className="err">{err}</div>}

        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} autoComplete="username"
               onChange={e => setEmail(e.target.value)} required autoFocus />

        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} autoComplete="current-password"
               onChange={e => setPassword(e.target.value)} required />

        <button className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
