import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { money } from './format.js'
import DocLink from './DocLink.jsx'

const num = v => Number(v) || 0

/**
 * Every supporting document for one transaction.
 *
 * One transaction can carry several receipts and several invoices as well as
 * the statement it was read from — T000643 has six. `quick_review_paths()`
 * returns only one of each because it feeds a compact row button; this is the
 * full list, from `web_transaction_documents()`.
 *
 * A document with no file on disk is shown but not offered as a link. It was
 * recorded from an email — vendor, date and amount only — and there is nothing
 * to open. Saying so beats a button that does nothing.
 */
export default function DocumentList({ txnId }) {
  const [docs, setDocs] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setDocs(null); setErr('')
    rpc('web_transaction_documents', { p_txn: txnId })
      .then(setDocs).catch(e => setErr(e.message))
  }, [txnId])

  if (err) return <div className="err">{err}</div>
  if (!docs) return <div className="loading">Reading documents…</div>
  if (!docs.length) return null

  const missing = docs.filter(d => !d.has_file).length

  return (
    <div className="note" style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <b>Supporting documents</b>
        <span className="muted" style={{ fontSize: 12 }}>
          {docs.length}
          {missing > 0 && ` · ${missing} with no file on disk`}
        </span>
      </div>

      <table style={{ marginTop: 6 }}>
        <tbody>
          {docs.map((d, i) => (
            <tr key={i}>
              <td style={{ width: 86 }}>
                <span className={'pill ' + (d.kind === 'statement' ? '' : 'soft')}>{d.kind}</span>
              </td>
              <td>
                {d.label}
                {d.reference && <span className="muted"> · {d.reference}</span>}
              </td>
              <td style={{ width: 96 }} className="muted">{d.doc_date || ''}</td>
              <td className="money" style={{ width: 110 }}>
                {num(d.amount) ? '$' + money(d.amount) : ''}
              </td>
              <td style={{ width: 140 }}>
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
