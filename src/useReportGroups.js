import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'

/**
 * Proprietor groups for the Balance sheet and Income statement — "Troy —
 * businesses (BRA + BMS)", "William — businesses (FSK + CRY)", and William's
 * everything-he-owns view including PER and HSE.
 *
 * The list comes from report_groups(), which builds it from businesses and
 * proprietors, so a new entity joins its owner's group without touching this
 * file. Each option's value is 'grp:<who>:<scope>'; `codes` is what
 * income_statement_group / balance_sheet_group take.
 *
 * If the function is missing (the migration has not been applied) the error is
 * returned rather than swallowed, so the page can say why the groups are absent.
 */
export function useReportGroups() {
  const [groups, setGroups] = useState([])
  const [err, setErr] = useState('')
  useEffect(() => {
    rpc('report_groups')
      .then(d => { setGroups(d || []); setErr('') })
      .catch(e => { setGroups([]); setErr(e.message) })
  }, [])
  return { groups, groupErr: err }
}
