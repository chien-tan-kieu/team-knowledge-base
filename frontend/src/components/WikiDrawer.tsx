import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useWikiPages } from '../hooks/useWiki'
import { ErrorBanner } from './ErrorBanner'

interface Props {
  open: boolean
  onClose: () => void
}

export function WikiDrawer({ open, onClose }: Props) {
  const { pages, loading, error } = useWikiPages()
  const { slug: currentSlug } = useParams<{ slug?: string }>()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  function handlePageClick() {
    if (window.matchMedia('(max-width: 767px)').matches) onClose()
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return pages
    return pages.filter(s => s.toLowerCase().includes(q))
  }, [pages, query])

  return (
    <>
      {/* Backdrop (mobile) */}
      <button
        type="button"
        aria-label="Close wiki pages"
        tabIndex={open ? 0 : -1}
        className={`fixed inset-0 top-14 z-30 bg-near-black/30 transition-opacity duration-200 ease-out ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      {/* Drawer — slides from top on mobile, from left of main on desktop */}
      <div
        className="fixed top-14 bottom-0 inset-x-0 z-40 pointer-events-none overflow-hidden md:inset-x-auto md:bottom-0"
        style={{
          left: 'var(--sidebar-w, 260px)',
          width: 'min(260px, 80vw)',
        }}
      >
        <aside
          aria-hidden={!open}
          className={[
            'pointer-events-auto absolute top-0 inset-x-0 max-h-[60vh] md:max-h-none md:bottom-0',
            'bg-canvas border-b md:border-b-0 md:border-r border-line overflow-y-auto pb-safe',
            'transition-transform duration-200 ease-out',
            open
              ? 'translate-y-0 md:translate-x-0'
              : '-translate-y-full md:translate-y-0 md:-translate-x-full',
          ].join(' ')}
        >
          <div className="px-4 md:px-5 pt-4 pb-3">
            <label className="block">
              <span className="sr-only">Search wiki pages</span>
              <span
                className="grid grid-cols-[14px_1fr] items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface"
                style={{ boxShadow: 'var(--shadow-ring)' }}
              >
                <svg
                  className="w-[13px] h-[13px] text-fg-dim"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path strokeLinecap="round" d="m20 20-3.5-3.5" />
                </svg>
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Filter pages…"
                  className="w-full bg-transparent outline-none text-[12.5px] text-fg placeholder:text-fg-dim font-sans py-0.5"
                />
              </span>
            </label>
          </div>

          <p className="px-4 md:px-5 pt-1 pb-2 text-[10px] font-medium text-fg-dim uppercase tracking-[0.14em] font-sans flex items-center gap-2">
            All Pages
            <span className="font-mono text-[10px] text-fg-dim">{filtered.length}</span>
          </p>

          {loading && (
            <p className="px-4 md:px-5 text-xs text-fg-dim font-sans">Loading…</p>
          )}
          {error && (
            <div className="px-4 md:px-5">
              <ErrorBanner error={error} />
            </div>
          )}

          <nav className="px-2 md:px-2.5">
            {filtered.map(s => {
              const active = s === currentSlug
              return (
                <Link
                  key={s}
                  to={`/wiki/${s}`}
                  onClick={handlePageClick}
                  className={[
                    'grid grid-cols-[8px_1fr] items-center gap-2 px-2 py-[5px] rounded-md',
                    'font-mono text-[13px] tracking-tight truncate',
                    active
                      ? 'bg-sand text-fg'
                      : 'text-fg-muted hover:bg-line hover:text-fg',
                  ].join(' ')}
                  style={active ? { boxShadow: 'var(--shadow-ring)' } : undefined}
                >
                  <span
                    className="inline-block w-1 h-1 rounded-full"
                    style={{
                      background: active
                        ? 'var(--color-accent)'
                        : 'var(--color-line-strong)',
                    }}
                    aria-hidden
                  />
                  <span className="truncate">{s}</span>
                </Link>
              )
            })}
            {!loading && !error && filtered.length === 0 && (
              <p className="px-2 py-3 text-xs text-fg-dim font-sans">
                {query ? 'No matches.' : 'No pages yet.'}
              </p>
            )}
          </nav>
        </aside>
      </div>
    </>
  )
}
