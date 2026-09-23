import { useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'

/**
 * "This is a …" — the control that moves a row out of a queue it does not
 * belong in. Nothing is booked; it only states what the thing is.
 *
 * Four of the five document classes answer "what is this piece of paper", and
 * go through `classify_document`. **Transfer or payment** does not: a row is in
 * queue 3 because of what the TRANSACTION is, and the row that needs it most —
 * T003913, "Branch Transaction ATM DEPOSIT" — has no document to classify at
 * all. So both go through `web_route_transaction`, which knows the difference.
 */
export const ROUTES = [
  ['invoice',          'Invoice for allocation',         'Allocate invoices',              true],
  ['receipt_expense',  'Receipt for allocation',         'Allocate expenses',              true],
  ['apply_to_invoice', 'Receipt to apply to an invoice', 'Assign receipts to invoices',    true],
  ['ap_statement',     'AP statement',                   'matches the invoice if it is here, otherwise Document matching', true],
  ['bank_statement',   'Bank or loan statement',         'leaves the review queues for the sweep to index', true],
  ['transfer',         'Transfer or payment',            'Transfers and payments — where the other side can be matched to it', false],
]

export default function ThisIsA({ txnId, receiptId, value, onDone, label = 'This is a' }) {
  const [groups, setGroups] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase.from('vendor_routes').select('label').eq('active', true).eq('route', 'group')
      .then(({ data }) => setGroups([...new Set((data || []).map(r => r.label))].sort()))
  }, [])

  async function route(as) {
    if (!as) return
    setBusy(true); setErr(''); setMsg('')
    try {
      const res = await rpc('web_route_transaction', {
        p_txn: txnId, p_as: as, p_receipt: receiptId || null,
      })
      setMsg(typeof res === 'string' ? res : 'Done.')
      if (onDone) onDone()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  // Without a document, only the transaction-level routes can be applied —
  // offering the rest would be offering an error message.
  const usable = ROUTES.filter(([, , , needsDoc]) => receiptId || !needsDoc)

  return (
    <div>
      <div className="bar" style={{ margin: '4px 0 0', padding: '5px 7px' }}>
        <span className="muted" style={{ fontSize: 12 }}>{label}</span>
        <select value={value || ''} disabled={busy}
                onChange={e => route(e.target.value)} style={{ maxWidth: 280 }}>
          <option value="">— leave as it is —</option>
          {usable.map(([v, text, where]) => (
            <option key={v} value={v} title={where}>{text}</option>
          ))}
          {receiptId && groups.length > 0 && (
            <optgroup label="Vendor groups">
              {groups.map(g => <option key={g} value={g}>{g} (revenue/vendor group)</option>)}
            </optgroup>
          )}
        </select>
        <span className="muted" style={{ fontSize: 11.5 }}>
          Says what it is and moves it to the queue that handles it. Nothing is booked.
        </span>
      </div>
      {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
      {msg && <div className="note good" style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  )
}
