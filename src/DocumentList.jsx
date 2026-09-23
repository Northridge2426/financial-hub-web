import { useCallback, useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'
import DocLink from './DocLink.jsx'
import ThisIsA from './ThisIsA.jsx'

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

export default function DocumentList({ txnId, onChanged, onCount }) {
  const [docs, setDocs] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setErr('')
    try {
      const d = await rpc('web_transaction_documents', { p_txn: txnId })
      setDocs(d)
      if (onCount) onCount(documentsCount(d))
    } catch (e) { setErr(e.message) }
  }, [txnId, onCount])

  useEffect(() => { setDocs(null); load() }, [load])


  if (err && !docs) return <div className="err">{err}</div>
  if (!docs) return <div className="loading">Reading documents…</div>
  if (!docs.length) return <div className="muted">No source document attached.</div>

  return (
    <div>
      {err && <div className="err">{err}</div>}

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
                  <ThisIsA txnId={txnId} receiptId={d.receipt_id}
                           value={d.reviewer_class}
                           onDone={async () => { await load(); if (onChanged) onChanged() }} />
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
