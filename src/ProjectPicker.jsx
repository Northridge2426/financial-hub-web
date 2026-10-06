import { useEffect, useRef, useState } from 'react'

/**
 * Project tags, as a button that opens a tick list.
 *
 * There were four different project controls in the app and three of them were
 * an always-open column of checkboxes — fine with two projects, a wall with
 * twelve, and on a nineteen-line document it ran the list down the page once
 * per line. This is the one William asked to see everywhere: a button showing
 * what is tagged, and the ticks only when you want them.
 *
 * The panel is positioned from the button's own rectangle and rendered over a
 * full-screen veil, so it escapes the table cell rather than stretching the row
 * — a tick list inside a <td> reflows every column next to it.
 *
 *   value     array of project ids
 *   onChange  called with the new array
 *   projects  [{ id, name }] — the caller already has this list
 */
export default function ProjectPicker({ value, projects, onChange, disabled, label = 'projects' }) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(null)
  const btn = useRef(null)

  const on = value || []
  const names = projects.filter(p => on.includes(p.id)).map(p => p.name)

  useEffect(() => {
    if (!open) return
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open])

  function show() {
    if (disabled) return
    const r = btn.current.getBoundingClientRect()
    // keep it on screen: a row near the bottom would otherwise open off it
    const top = Math.min(r.bottom + 4, window.innerHeight - 240)
    setAt({ top: Math.max(8, top), left: Math.min(r.left, window.innerWidth - 260) })
    setOpen(true)
  }

  function toggle(id) {
    onChange(on.includes(id) ? on.filter(x => x !== id) : [...on, id])
  }

  return (
    <>
      <button ref={btn} className="projbtn" disabled={disabled} onClick={show}
              title={names.length ? names.join(', ') : 'No project tags'}>
        {names.length ? (names.length > 2 ? `${names.length} projects` : names.join(', ')) : label}
      </button>

      {open && at && (
        <>
          <div className="pickveil" onClick={() => setOpen(false)} />
          <div className="projpick" style={{ top: at.top, left: at.left }}>
            {projects.length === 0 && <div className="muted">No active projects.</div>}
            {projects.map(p => (
              <label key={p.id} className="tick">
                <input type="checkbox" checked={on.includes(p.id)}
                       onChange={() => toggle(p.id)} />
                {p.name}
              </label>
            ))}
            <div className="bar" style={{ margin: '6px 0 0', padding: 0 }}>
              {on.length > 0 && (
                <button onClick={() => onChange([])}>clear</button>
              )}
              <span style={{ flex: 1 }} />
              <button onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
