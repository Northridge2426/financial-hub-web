import { useState } from 'react'

/**
 * A pointer to a document that lives in OneDrive, not in the database.
 *
 * The console opens these by asking Cowork to open a local file. A web page
 * cannot do that: a `file://` link from an https origin is blocked by every
 * browser, and no amount of coding gets round it.
 *
 * Until a OneDrive share link is stored against each document, the useful thing
 * is the path itself — copyable in one click, so it can be pasted into Explorer
 * or the OneDrive search box.
 *
 * If `baseUrl` is set (a shared-folder link), the path is turned into a real
 * deep link instead and this becomes a proper button.
 */
export default function DocLink({ path, label = 'document', baseUrl }) {
  const [copied, setCopied] = useState(false)
  if (!path) return null

  const deep = baseUrl
    ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}path=${encodeURIComponent('/' + path)}`
    : null

  async function copy() {
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard is blocked in some contexts; the path is on screen regardless.
      setCopied(false)
    }
  }

  if (deep) {
    return (
      <a className="pill soft" href={deep} target="_blank" rel="noreferrer"
         title={path} style={{ textDecoration: 'none' }}>
        open {label}
      </a>
    )
  }

  return (
    <span className="doclink" title={path}>
      <button onClick={copy}>{copied ? 'copied' : `copy ${label} path`}</button>
      <span className="muted" style={{ fontSize: 10.5, marginLeft: 6 }}>{path}</span>
    </span>
  )
}
