import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. ' +
    'Copy .env.example to .env and fill both in, then restart the dev server — ' +
    'Vite only reads .env at startup.'
  )
}

export const supabase = createClient(url, key, {
  auth: {
    // Keep the session in localStorage and refresh it silently, so signing in is
    // a rare event rather than a daily chore. This is why we chose password over
    // magic link: a long-lived session means the password is typed seldom.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

/**
 * Call a Postgres function. Every one of the hub's 267 functions is executable by
 * the `authenticated` role, but the tables underneath are still gated by RLS — so
 * a signed-out caller gets nothing rather than an error. Errors are thrown so a
 * page never renders a silent empty state that looks like "no data".
 */
export async function rpc(fn, args = {}) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data ?? []
}
