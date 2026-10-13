import { useEffect, useState } from 'react'
import { rpc } from './supabase.js'

/**
 * The banner across the top of every page.
 *
 * Built after the September 2026 Square import sat on hold for three weeks as a
 * priority-1 reminder that nothing put in front of William — so September's
 * boarding revenue was simply missing from every report. hub_alerts() returns:
 *
 *   blocking  reminders flagged `blocking` (holds, refused imports — the sweep
 *             sets the flag when it raises one), and processor reports that are
 *             filed but whose month has no entries in the ledger;
 *   warning   payouts with no sales behind them, proposed entries left waiting.
 *
 * The derived checks ask the ledger, not a log, so they clear themselves the
 * moment the work is done. Refetched on every page change, like the badges.
 *
 * Errors are SHOWN, never swallowed: an empty banner must mean "nothing is
 * wrong", not "the check did not run".
 */
export default function HubAlerts({ refreshKey, onGo }) {
  const [alerts, setAlerts] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    rpc('web_hub_alerts')
      .then(d => { setAlerts(d); setErr('') })
      .catch(e => { setAlerts(null); setErr(e.message) })
  }, [refreshKey])

  if (err) {
    return (
      <div className="hubalert warn">
        <b>Alerts unavailable.</b>{' '}
        <span className="fine">The check behind this banner did not run — {err}</span>
      </div>
    )
  }
  if (!alerts || alerts.length === 0) return null

  const blocking = alerts.filter(a => a.severity === 'blocking')
  const warnings = alerts.filter(a => a.severity !== 'blocking')
  const tone = blocking.length ? 'bad' : 'warn'
  const lead = blocking[0] || warnings[0]
  const more = alerts.length - 1

  return (
    <div className={'hubalert ' + tone}>
      <div className="hubalert-head">
        <span className="hubalert-tag">{blocking.length ? 'Needs attention' : 'Heads up'}</span>
        <span className="hubalert-title">{lead.title}</span>
        {more > 0 && (
          <button className="linkish" onClick={() => setOpen(!open)}>
            {open ? 'hide' : `+ ${more} more`}
          </button>
        )}
        {more === 0 && (
          <button className="linkish" onClick={() => setOpen(!open)}>
            {open ? 'hide' : 'details'}
          </button>
        )}
      </div>
      {open && (
        <ul className="hubalert-list">
          {[...blocking, ...warnings].map((a, i) => (
            <li key={i} className={a.severity === 'blocking' ? 'b' : 'w'}>
              <div className="t">{a.title}</div>
              {a.detail && <div className="d">{a.detail}</div>}
              <div className="m">
                {a.since && <>since {a.since} · </>}
                {a.go_to && (
                  <a href="#" onClick={e => { e.preventDefault(); onGo(a.go_to) }}>
                    open {a.go_to === 'proposed' ? 'Proposed entries' : 'Reminders'}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
