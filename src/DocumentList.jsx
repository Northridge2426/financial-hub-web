import { useCallback, useEffect, useState } from 'react'
import { supabase, rpc } from './supabase.js'
import { money } from './format.js'
import DocLink from './DocLink.jsx'

const num = v => Number(v) || 0

/**
 * Every supporting document for one transaction, and the "This is a …" control
 * that says what each one is.
 *
 * The classifier is how a row leaves a queue it is wrongly in. Saying a payment
 * is a transfer moves it to the transfers queue; saying a document is an AP
 * statement moves it to document matching. Nothing is booked — it only states
 * what the thing is.
 *
 * Only documents attached to THIS transaction can be reclassified. One filed
 * against the journal entry belongs to that entry, not to this row.
 */
const DOC_CLASSES = [
  ['invoice',          'Invoice for allocation',         'Allocate invoices'],
  ['receipt_expense',  'Receipt for allocation',         'Allocate expenses'],
  ['apply_to_invoice', 'Receipt to apply to an invoice', 'Assign receipts to invoices'],
  ['ap_statement',     'AP statement',                   'matches the invoice if it is here, otherwise Document matching'],
  ['bank_statement',   'Bank or loan statement',         'leaves the review queues for the sweep to index'],
]

export default function DocumentList({ txnId, onChanged, onCount }) {
  const [docs, setDocs] = useState(null)
  const [groups, setGroups] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setErr('')
    try {
      const d = await rpc('web_transaction_documents', { p_txn: txnId })
      setDocs(d)
      if (onCount) onCount(documentsCount(d))
    } catch (e) { setErr(e.message) }
  }, [txnId, onCount])

  useEffect(() => { setDocs(null); load() }, [load])

  useEffect(() => {
    supabase.from('vendor_routes').select('label').eq('active', true).eq('route', 'group')
      .then(({ data }) => setGroups([...new Set((data || []).map(r => r.label))].sort()))
  }, [])

  async function classify(receiptId, as) {
    if (!as) return
    setBusy(receiptId); setErr(''); setMsg('')
    try {
      const res = await rpc('classify_document', { p_receipt: receiptId, p_as: as })
      setMsg(typeof res === 'string' ? res : 'Classified.')
      await load()
      if (onChanged) onChanged()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  if (err && !docs) return <div className="err">{err}</div>
  if (!docs) return <div className="loading">Reading documents…</div>
  if (!docs.length) return <div className="muted">No source document attached.</div>

  return (
    <div>
      {err && <div className="err">{err}</div>}
      {msg && <div className="note good">{msg}</div>}

      <table>
        <tbody>
          {docs.map((d, i) => (
            <tr key={i}>
              <td style={{ width: 86 }}>
                <span className={'pill ' + (d.kind === 'statement' ? '' : 'soft')}>{d.kind}</span>
              </td>
              <td>
                {d.label}
                {d.reference && <span className="muted"> · {d.reference}</span>}
                {!d.own_transaction && d.kind !== 'statement' && (
                  <span className="muted" style={{ fontSize: 11 }}> · filed against the journal entry</span>
                )}

                {d.own_transaction && d.receipt_id && (
                  <div className="bar" style={{ margin: '4px 0 0', padding: '5px 7px' }}>
                    <span className="muted" style={{ fontSize: 12 }}>This is a</span>
                    <select value={d.reviewer_class || ''} disabled={busy === d.receipt_id}
                            onChange={e => classify(d.receipt_id, e.target.value)}
                            style={{ maxWidth: 260 }}>
                      <option value="">— leave as it is —</option>
                      {DOC_CLASSES.map(([v, label, where]) => (
                        <option key={v} value={v} title={where}>{label}</option>
                      ))}
                      {groups.length > 0 && (
                        <optgroup label="Vendor groups">
                          {groups.map(g => (
                            <option key={g} value={g}>{g} (revenue/vendor group)</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      Says what it is and moves it to the queue that handles it. Nothing is booked.
                    </span>
                  </div>
                )}
              </td>
              <td style={{ width: 96 }} className="muted">{d.doc_date || ''}</td>
              <td className="money" style={{ width: 110 }}>
                {num(d.amount) ? '$' + money(d.amount) : ''}
              </td>
              <td style={{ width: 130 }}>
                {d.has_file
                  ? <DocLink path={d.path} label="copy path" />
                  : <span className="muted" style={{ fontSize: 11 }}
                          title="Recorded from an email — vendor, date and amount only. No file was ever saved.">
                      no file
                    </span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** For the shut header: "3 documents · 1 with no file". */
export function documentsCount(docs) {
  if (!docs || !docs.length) return ''
  const missing = docs.filter(d => !d.has_file).length
  return `${docs.length} document${docs.length === 1 ? '' : 's'}`
       + (missing ? ` · ${missing} with no file` : '')
}
