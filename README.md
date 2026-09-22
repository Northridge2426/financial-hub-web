# Financial Hub — web console

A browser front end for the same Supabase database the artifact console reads.
The difference is how it gets there:

| | Reaches the database as | RLS |
|---|---|---|
| `hub-live.html` (artifact) | **service role**, via MCP | bypassed |
| this app | **you**, signed in | enforced |

Both read the same data. Neither can break the other.

---

## Running it

```bash
cd webapp
npm install
npm run dev
```

Then open http://localhost:5173 and sign in with your Supabase account.

`.env` already holds the project URL and publishable key. **Vite reads `.env`
only at startup** — restart the dev server after changing it.

## Building for deployment

```bash
npm run build      # -> dist/
npm run preview    # serve dist/ locally to check it
```

`dist/` is a folder of static files. Any static host will serve it.

---

## What is safe to put in this folder

The **publishable key** in `.env` is designed to sit in a browser. On its own it
grants nothing: every table is gated by RLS, and an unauthenticated caller reads
zero rows from all 76 of them (verified 22 Sep 2026).

**The service role key must never appear here.** It bypasses RLS entirely, and in
a front-end bundle it would hand the whole ledger to anyone who opened the page
source. There is no legitimate reason for it to be in this folder.

---

## The rule that keeps the artifact working

The console calls 68 database functions and 29 views. **Only add — never modify
or drop any of them.** If something misbehaves under RLS, change the *policy*
(invisible to the service role) or write a *new* function. Never edit the one the
console calls.

See `../WEB APP — parity inventory.md` for the full list and the page checklist.
A byte-identical backup of the console sits in `../Archived/console-backups/`.

---

## What had to change in the database

One thing, on 22 Sep 2026, and it was additive:

Only **23 of 267** functions were executable by the `authenticated` role — and one
of the missing ones was `is_app_user()`, which all 75 RLS policies call. Postgres
evaluates a policy with the *caller's* privileges, so every query by a signed-in
user failed with `permission denied for function is_app_user`. The whole database
was unreachable for anyone who signed in.

Fixed with `grant execute on all functions in schema public to authenticated`,
plus a default privilege so a function added later is not silently unreachable.
No function body, signature or policy was touched. `anon` was deliberately left
with nothing.

`vendor_aliases` was also the only one of 76 tables without RLS — created
21 Sep and missed. It now has the same `is_app_user()` policy as the rest.

---

## Structure

```
webapp/
  index.html         entry
  vite.config.js
  .env               URL + publishable key  (git-ignored)
  .env.example       the shape, for a fresh clone
  src/
    main.jsx         mounts React
    App.jsx          session, tab bar, page switch
    SignIn.jsx       email + password
    Overview.jsx     first real page — financial_overview()
    supabase.js      client + rpc() helper
    styles.css
```

Pages get added to the `PAGES` array in `App.jsx`, one per build, in order of how
much they are used — the daily queues first, the year-end reports last.
