import { useEffect, useState } from 'react'

/**
 * Tabs for a detail panel — the transaction editor, the invoice editor, and any
 * other panel that stacks several jobs on one row.
 *
 * Replaces a column of folds. Folds let the panel grow to several screens once
 * two or three were open; tabs keep it one section tall, so the job you want
 * is one click away instead of a scroll.
 *
 * Two rules carried over from the folds, because they were learned the hard way:
 *
 *  - A tab you are NOT looking at still says whether it needs you. `badge` is
 *    "3", "does not balance", "2 ticked" — and `tone: 'warn'` colours it. A tab
 *    that hides whether something is wrong is worse than no tab.
 *
 *  - Switching tabs never throws work away. A pane, once shown, stays mounted
 *    (hidden), so ticked payables, half-coded document lines and the draft
 *    entry all survive a look at another tab. `alwaysMounted` mounts a pane
 *    before it is ever opened — for panes that report their own badge, or that
 *    decide by loading whether their tab should exist at all.
 *
 *   tabs      [{ key, label, badge, tone, hidden, alwaysMounted, content }]
 *   active    the key the parent wants shown
 *   fallback  shown when `active` is hidden on this row (else the first tab)
 *   onChange  called with the key clicked
 */
export default function Tabs({ tabs, active, fallback, onChange }) {
  const shown = tabs.filter(t => !t.hidden)
  const has = k => shown.some(t => t.key === k)
  const cur = has(active) ? active : has(fallback) ? fallback : shown[0]?.key

  const [visited, setVisited] = useState(() => new Set([cur]))
  useEffect(() => {
    setVisited(v => (v.has(cur) ? v : new Set(v).add(cur)))
  }, [cur])

  return (
    <div className="ptabs">
      <div className="ptabbar" role="tablist">
        {shown.map(t => (
          <button key={t.key} type="button" role="tab"
                  aria-selected={t.key === cur}
                  className={'ptab' + (t.key === cur ? ' on' : '')}
                  onClick={() => onChange && onChange(t.key)}>
            {t.label}
            {t.badge ? <span className={'ptabbadge ' + (t.tone || '')}>{t.badge}</span> : null}
          </button>
        ))}
      </div>
      {tabs.map(t => {
        const showing = t.key === cur && !t.hidden
        if (!(t.alwaysMounted || showing || visited.has(t.key))) return null
        return (
          <div key={t.key} role="tabpanel" className="ptabpane"
               style={showing ? undefined : { display: 'none' }}>
            {t.content}
          </div>
        )
      })}
    </div>
  )
}
