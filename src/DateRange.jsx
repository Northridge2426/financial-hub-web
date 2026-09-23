/**
 * The date range and its snaps, as the console has them.
 *
 * "Year" is the fiscal year — from 2026-01-01, not a rolling 365 days.
 * That distinction matters: a rolling year would reach back into 2025,
 * which is a closed book and deliberately out of every queue.
 *
 * Value is `{ from, to }` as ISO strings, or empty strings for no bound.
 */
const FISCAL_START = '2026-01-01'

const iso = d => d.toISOString().slice(0, 10)

function back(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return iso(d)
}

function backMonths(n) {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return iso(d)
}

export const SNAPS = [
  ['30d',  () => ({ from: back(30),        to: '' })],
  ['60d',  () => ({ from: back(60),        to: '' })],
  ['90d',  () => ({ from: back(90),        to: '' })],
  ['6m',   () => ({ from: backMonths(6),   to: '' })],
  ['Year', () => ({ from: FISCAL_START,    to: '' })],
  ['All',  () => ({ from: '',              to: '' })],
]

export default function DateRange({ value, onChange }) {
  const { from = '', to = '' } = value || {}
  const set = patch => onChange({ from, to, ...patch })

  return (
    <>
      <label>From</label>
      <input type="date" value={from} onChange={e => set({ from: e.target.value })}
             style={{ width: 148 }} />
      <label>to</label>
      <input type="date" value={to} onChange={e => set({ to: e.target.value })}
             style={{ width: 148 }} />
      {SNAPS.map(([label, fn]) => (
        <button key={label} type="button" onClick={() => onChange(fn())}
                style={{ padding: '5px 9px', fontSize: 12 }}>
          {label}
        </button>
      ))}
    </>
  )
}
