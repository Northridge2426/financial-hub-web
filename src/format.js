/** Shared formatting. Money must never reflow as digits change — see .money in styles.css. */

export const money = n =>
  Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Today as YYYY-MM-DD in local time. `toISOString()` would give UTC, which is
 *  tomorrow's date for part of every evening here. */
export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 2026-09-25 -> "Fri 25 Sep". Parsed as local, not UTC: `new Date('2026-09-25')`
 *  is midnight UTC, which reads as the previous day west of Greenwich. */
export const shortDate = iso => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}
