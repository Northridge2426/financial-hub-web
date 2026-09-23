import { useEffect, useRef, useState } from 'react'

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
export default function Section({ title, count, tone, defaultOpen = false, openSignal, children }) {
  const [open, setOpen] = useState(!!defaultOpen)

  // `openSignal` lets the parent insist: applying an allocation profile fills
  // this grid, and a fold that stays shut over the result makes it look as
  // though the profile posted something on its own. Only ever opens — it never
  // shuts a section the reader opened.
  const seen = useRef(openSignal)
  useEffect(() => {
    if (openSignal !== seen.current) { seen.current = openSignal; if (openSignal) setOpen(true) }
  }, [openSignal])

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
