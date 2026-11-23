/**
 * Quick period presets for the reports — a dropdown beside the From/To dates.
 *
 * Periods are calendar: every entity's fiscal year is the calendar year, so
 * "Year to date" starts 1 January and quarters are Jan–Mar, Apr–Jun, …
 *
 * "This month", "This quarter" and "Year to date" end TODAY, not at the end of
 * the period — the same as the reports' own default, and the header then says
 * what was actually counted. "Last …" periods are complete.
 *
 * Dates are built in local time. `toISOString()` is UTC, which in Edmonton is
 * already tomorrow from 6 pm — a preset picked in the evening would be a day off.
 *
 * The select shows whichever preset matches the dates on screen, so typing
 * dates by hand drops it back to "Custom".
 */
import { today } from './format.js'

/** The ledger starts here. 2025 is carried only as closing balances. */
const BOOKS_START = '2026-01-01'

const pad = n => String(n).padStart(2, '0')
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`           // m is 0-based
const first = (y, m) => { const d = new Date(y, m, 1); return ymd(d.getFullYear(), d.getMonth(), 1) }
const last  = (y, m) => { const d = new Date(y, m + 1, 0); return ymd(d.getFullYear(), d.getMonth(), d.getDate()) }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Every preset as [key, label, {from, to}], grouped for the dropdown. */
export function periodPresets(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth(), t = today()
  const q = Math.floor(m / 3) * 3                                    // first month of this quarter

  const main = [
    ['tm',  'This month',      { from: first(y, m),      to: t }],
    ['lm',  'Last month',      { from: first(y, m - 1),  to: last(y, m - 1) }],
    ['tq',  'This quarter',    { from: first(y, q),      to: t }],
    ['lq',  'Last quarter',    { from: first(y, q - 3),  to: last(y, q - 1) }],
    ['ytd', 'Year to date',    { from: ymd(y, 0, 1),     to: t }],
    ['ty',  'This year (full)', { from: ymd(y, 0, 1),    to: ymd(y, 11, 31) }],
    ['l12', 'Last 12 months',  { from: first(y, m - 11), to: t }],
    ['ly',  'Last year',       { from: ymd(y - 1, 0, 1), to: ymd(y - 1, 11, 31) }],
    ['lytd', 'Last year to same date', {
      from: ymd(y - 1, 0, 1),
      to: (() => { const d = new Date(y - 1, m, now.getDate()); return d.getMonth() === m
        ? ymd(y - 1, m, now.getDate()) : last(y - 1, m) })(),     // 29 Feb → 28 Feb
    }],
  ]

  const quarters = []
  for (let i = 0; i <= q / 3; i++) {
    quarters.push([`q${i + 1}`, `Q${i + 1} ${y}`, { from: first(y, i * 3), to: last(y, i * 3 + 2) }])
  }

  const months = []
  for (let i = m; i >= 0; i--) {
    months.push([`m${i}`, `${MONTHS[i]} ${y}`, { from: first(y, i), to: last(y, i) }])
  }

  return [['Periods', main], ['Quarters', quarters], ['Months', months]]
}

/** Month-end / quarter-end / year-end dates for an "as at" report. */
export function asOfPresets(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth()
  const q = Math.floor(m / 3) * 3
  const main = [
    ['td',  'Today',                 today()],
    ['elm', 'End of last month',     last(y, m - 1)],
    ['elq', 'End of last quarter',   last(y, q - 1)],
    ['ely', 'End of last year',      ymd(y - 1, 11, 31)],
  ]
  const months = []
  for (let i = m - 1; i >= 0; i--) months.push([`me${i}`, `End of ${MONTHS[i]} ${y}`, last(y, i)])
  return [['Dates', main], ['Month ends', months]]
}

const sel = { width: 'auto', fontSize: 13 }

/**
 * from/to presets. onChange receives `{ from, to }` — set both together so the
 * report runs once, not twice.
 *
 * `allowAll` adds an "All dates" choice that clears both bounds, for pages
 * where an empty range means no date filter.
 */
export default function PeriodPicker({ from, to, onChange, disabled, allowAll }) {
  const groups = periodPresets()
  const flat = groups.flatMap(([, items]) => items)
  const match = !from && !to && allowAll
    ? 'all'
    : (flat.find(([, , r]) => r.from === from && r.to === to) || [''])[0]

  const pick = key => {
    if (key === 'all') return onChange({ from: '', to: '' })
    const hit = flat.find(([k]) => k === key)
    if (hit) onChange({ ...hit[2] })
  }

  return (
    <>
      <select value={match} disabled={disabled} onChange={e => pick(e.target.value)}
              aria-label="Period" title="Quick period" style={sel}>
        <option value="">Custom dates</option>
        {allowAll && <option value="all">All dates</option>}
        {groups.map(([label, items]) => items.length > 0 && (
          <optgroup key={label} label={label}>
            {items.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </optgroup>
        ))}
      </select>
      <BeforeBooks from={from} />
    </>
  )
}

/** A single "as at" date's presets, for the balance sheet. onChange receives the date. */
export function AsOfPicker({ value, onChange, disabled }) {
  const groups = asOfPresets()
  const flat = groups.flatMap(([, items]) => items)
  const match = (flat.find(([, , d]) => d === value) || [''])[0]
  return (
    <select value={match} disabled={disabled} aria-label="As at"
            onChange={e => { const hit = flat.find(([k]) => k === e.target.value); if (hit) onChange(hit[2]) }}
            style={sel}>
      <option value="">Custom date</option>
      {groups.map(([label, items]) => items.length > 0 && (
        <optgroup key={label} label={label}>
          {items.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

/**
 * The ledger has no activity before 1 Jan 2026 — 2025 was loaded as closing
 * balances only — so a period that reaches back there would quietly show
 * nothing for those months. Say so beside the dates.
 */
function BeforeBooks({ from }) {
  if (!from || from >= BOOKS_START) return null
  return (
    <span className="muted" style={{ fontSize: 12 }}
          title="2025 was loaded as closing balances (opening entries on 1 Jan 2026), not as transactions.">
      Activity starts 1 Jan 2026 — 2025 has closing balances only.
    </span>
  )
}
