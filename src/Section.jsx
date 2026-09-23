import { useState } from 'react'

/**
 * A foldable section in the transaction panel.
 *
 * The console's reasoning, kept: the open/shut state is held in React state
 * rather than in a `<details>` element, because the panel re-renders after
 * almost every action and a native `<details>` would spring shut mid-edit.
 *
 * `count` is what the SHUT header says instead of nothing — "4 lines", "does
 * not balance", "3 documents". A fold that hides whether something needs
 * attention is worse than no fold at all.
 */
export default function Section({ title, count, tone, defaultOpen = false, children }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div className={'sec' + (open ? ' on' : '')}>
      <div className="sechead" onClick={() => setOpen(o => !o)}>
        <span className="caretw">{open ? '▾' : '▸'}</span>
        <b>{title}</b>
        {count && <span className={'seccount ' + (tone || '')}>{count}</span>}
      </div>
      {open && <div className="secbody">{children}</div>}
    </div>
  )
}
