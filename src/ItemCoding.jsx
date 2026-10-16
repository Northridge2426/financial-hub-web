import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'

/**
 * How one item was coded — every journal line that books it, wherever it
 * lives, grouped by where it came from: the bank line's own entry, the Sage
 * entry linked to it, an adjustment, the other leg of a transfer, the invoice's
 * own lines, and the payment that settled it. One call: web_item_coding.
 * Read-only; recoding belongs in the review queues.
 */
export default function ItemCoding({ txnId, receiptId }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setRows(null); setErr('')
    rpc('web_item_coding', { p_txn: txnId || null, p_receipt: receiptId || null })
      .then(setRows).catch(e => setErr(e.message))
  }, [txnId, receiptId])

  if (err) return <div className="err">{err}</div>
  if (!rows) return <div className="loading">Reading the coding…</div>
  if (!rows.length) return <div className="muted">Not coded — no journal lines book this item yet.</div>

  const groups = []
  for (const r of rows) {
    let g = groups.find(x => x.source === r.source)
    if (!g) { g = { source: r.source, rows: [] }; groups.push(g) }
    g.rows.push(r)
  }

  return (
    <div className="coding">
      {groups.map(g => {
        const d = g.rows.reduce((a, r) => a + Number(r.debit || 0), 0)
        const c = g.rows.reduce((a, r) => a + Number(r.credit || 0), 0)
        return (
          <div key={g.source} className="codinggroup">
            <div className="codinghead">
              <b>{g.source}</b>
              <span className="muted">{g.rows[0].entry_date || ''}</span>
              {Math.abs(d - c) > 0.004 && <span className="pill bad">out by {money(d - c)}</span>}
            </div>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '7%' }}>Entity</th>
                  <th style={{ width: '8%' }}>Account</th>
                  <th>Name</th>
                  <th className="num" style={{ width: '12%' }}>Debit</th>
                  <th className="num" style={{ width: '12%' }}>Credit</th>
                  <th style={{ width: '30%' }}>Memo</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="muted">{r.business}</td>
                    <td className="muted">{r.gl_number}</td>
                    <td>{r.account_name}</td>
                    <td className="money">{Number(r.debit) ? money(r.debit) : ''}</td>
                    <td className="money">{Number(r.credit) ? money(r.credit) : ''}</td>
                    <td className="muted" style={{ fontSize: 11.5 }}>
                      {r.memo || ''}
                      {r.project && <span className="pill soft">{r.project}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
