import { useState } from 'react'

/**
 * A pointer to a document that lives in OneDrive, not in the database.
 *
 * The console opens these by asking Cowork to open a local file. A web page
 * cannot: a `file://` link from an https origin is blocked by every browser,
 * and no amount of coding gets round it.
 *
 * So this gives you the same Windows path the console falls back to, copied in
 * one click, to paste into Explorer. Unlike the artifact — where
 * `navigator.clipboard` is blocked by the sandbox and the fallback is selecting
 * text in a field — this is a real browser on https, so the copy actually works.
 *
 * When a OneDrive share link is eventually stored, set `baseUrl` and this turns
 * into a proper link that opens on any device.
 */

/** Matches WINROOT in hub-live.html. Both must change together if the folder moves. */
export const WINROOT = 'C:\\Users\\billy\\OneDrive\\Documents\\! Claude\\Financial\\'
export const winPath = p => WINROOT + String(p).replace(/\//g, '\\')

export default function DocLink({ path, label = 'doc', baseUrl, title }) {
  const [copied, setCopied] = useState(false)
  if (!path) return null

  const win = winPath(path)

  const deep = baseUrl
    ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}path=${encodeURIComponent('/' + path)}`
    : null

  async function copy(e) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(win)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Blocked in some contexts. Select the text instead so it can still be taken.
      const r = document.createRange()
      r.selectNodeContents(e.currentTarget.parentNode.querySelector('.pathtxt'))
      const sel = window.getSelection()
      sel.removeAllRanges(); sel.addRange(r)
    }
  }

  if (deep) {
    return (
      <a className="pill soft" href={deep} target="_blank" rel="noreferrer"
         title={title || win} onClick={e => e.stopPropagation()}
         style={{ textDecoration: 'none' }}>
        open {label}
      </a>
    )
  }

  return (
    <span className="doclink">
      <button onClick={copy} title={title || win}>
        {copied ? '✓ copied' : label}
      </button>
      <span className="pathtxt" hidden>{win}</span>
    </span>
  )
}
