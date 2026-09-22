/** Shared formatting. Money must never reflow as digits change — see .money in styles.css. */

export const money = n =>
  Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 2026-09-25 -> "Fri 25 Sep". Parsed as local, not UTC: `new Date('2026-09-25')`
 *  is midnight UTC, which reads as the previous day west of Greenwich. */
export const shortDate = iso => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}
