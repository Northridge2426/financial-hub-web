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
  vite.config.js     base path + build stamp
  .env               URL + publishable key  (git-ignored)
  .env.example       the shape, for a fresh clone
  src/
    main.jsx         mounts React
    App.jsx          session, grouped navigation, page switch
    SignIn.jsx       email + password
    supabase.js      client + rpc() helper
    format.js        money, today, shortDate
    useEntities.js   the active businesses, for every entity filter
    DrillLines.jsx   report_drilldown — the lines behind a figure
    StatementTable.jsx  sectioned statement + drill (balance sheet, income statement)
    styles.css
    …27 page components
```

**All 27 pages are built.** They are grouped in `App.jsx` — Daily, Payables, The
books, Statements, Reports — because 27 tabs in one row is unreadable and
unusable on a phone. Pick a group, then a page within it; the choice is
remembered in `localStorage`.

Pages are stored as *components*, not elements, so switching to one mounts it
fresh and it refetches rather than showing figures read an hour ago.

## Check this after adding ANY function call

Four failure classes account for nearly every bug in this build. Each was
reported as one broken page, fixed as one broken page, and reappeared
elsewhere. Each was only closed by enumerating it across the whole database —
and every sweep found instances nobody had hit yet, twice including code
written the same day.

Run all four against the functions the app calls. All four returned zero rows
on 23 September 2026.

1. **No EXECUTE.** A console-only function carries no grant to `authenticated`,
   because nobody ever needed one.
   `has_function_privilege('authenticated', oid, 'EXECUTE')`.
2. **Invoker cannot reach what it calls.** A `SECURITY INVOKER` function whose
   body calls a function the caller cannot execute. The grant on the front door
   is not the question: `prosrc ~* '\m<blocked>\s*\('`.
3. **Unqualified DELETE.** `prosrc ~* 'delete\s+from\s+[a-z_0-9]+\s*;'`.
   `safeupdate` is a **session library** on `authenticator` — neither
   `SECURITY DEFINER` nor setting `safeupdate.enabled` on the function gets
   round it, both were tried. The statement itself must say `where true`. Only
   ever apply this to a table the same function created as TEMP.
4. **Ambiguous overload.** Two signatures whose named arguments the call site
   does not distinguish. `link_ap_payment` is the trap: omitting
   `p_allow_difference` is ambiguous, **not defaulted**.

## Two rules this app broke and had to relearn

- **Never rebuild a database rule in the browser.** Two front ends write to the
  same live database; anything expressed twice will drift. A queue's WHERE
  clause comes from `web_review_queue()`; the sign on a credit note comes from
  `web_invoice_seed()`. This project has already lost eleven payments,
  $17,247.77, to a queue rule that existed in two places.
- **A guard belongs in a RAISE, not in a WHERE clause.** An `is_app_user()`
  gate in a SQL function's WHERE returns an **empty list** to a caller who
  fails it — indistinguishable from "there is nothing here". The same shape in
  JavaScript, `.catch(() => setCounts(null))`, hid a timing-out `queue_counts`
  for an entire push: the menu badges simply never appeared and looked
  unbuilt. Every `web_*` function raises. Every catch surfaces its message.

## Things that bite when porting a pane

- **Calls are by named argument.** The console writes `payments_due(30, null)`;
  here it is `rpc('payments_due', { p_days: 30, p_business: null })`. Get the
  names from `pg_get_function_arguments`, don't guess.
- **Overloads resolve by argument name.** `vendor_activity`, `project_report`
  and `account_ledger` are all overloaded. Supplying one signature's full named
  set disambiguates — except `account_ledger`, where both versions call the
  first parameter `p_account`. That one needed a wrapper.
- **Columns that read like booleans are often `bigint` counts.** In
  `v_chart_of_accounts`: `posted_here`, `in_sage_journal`, `used_by_allocations`,
  `used_by_roles`, `is_a_bank_account`. In JSX `0 && <span/>` renders a literal
  **0** — it compiles clean and looks broken. Coerce with `> 0`.
- **A count is `bigint`, not `integer`, and `plpgsql` will not forgive it.**
  `v_review_queue.docs`, `.doc_stubs`, `.splits` and `.jlines` are all bigint.
  A wrapper declaring them `integer` works fine in `language sql`, which
  coerces silently — then fails with *"structure of query does not match
  function result type"* the moment it is rewritten as `plpgsql` with
  `return query`, which requires an exact row type. The bug is latent from the
  start and only surfaces on rewrite. Read the column types from
  `information_schema` when declaring a RETURNS TABLE; do not infer them.
- **Vite does not fail on missing env vars.** A build with absent secrets goes
  green and bakes in blanks; the app then dies in the browser. Green build ≠
  working site.
- **GitHub Pages caches `index.html` for ten minutes.** Asset names are
  fingerprinted and safe; the HTML pointing at them is not. The commit SHA in
  the nav bar tells you which build you are actually looking at.

## Deploying

Push to `main`. The workflow builds and publishes to
`https://northridge2426.github.io/financial-hub-web/`, reading the two secrets
from the repository's Actions secrets. Pushing is done from a local clone with
Git Credential Manager — no token is stored anywhere.
