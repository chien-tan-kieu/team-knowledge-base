import { useEffect } from 'react'
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

  return (
    <>
      <button
        type="button"
        aria-label="Close wiki pages"
        tabIndex={open ? 0 : -1}
        className={`fixed inset-0 top-13 z-30 bg-near-black/30 transition-opacity duration-200 ease-out ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <div className="fixed top-13 bottom-0 inset-x-0 z-40 pointer-events-none overflow-hidden md:inset-x-auto md:left-55 md:w-64">
        <aside
          aria-hidden={!open}
          className={`pointer-events-auto absolute top-0 inset-x-0 max-h-[60vh] md:bottom-0 md:max-h-none bg-ivory border-border-cream border-b md:border-b-0 md:border-r overflow-y-auto pb-safe transition-transform duration-200 ease-out ${
            open
              ? 'translate-y-0 md:translate-x-0'
              : '-translate-y-full md:translate-y-0 md:-translate-x-full'
          }`}
        >
          <p className="px-4 sm:px-3 pt-4 pb-2 text-xs font-medium text-stone-gray uppercase tracking-widest font-sans">
            All Pages
          </p>
          {loading && <p className="px-4 sm:px-3 text-xs text-stone-gray font-sans">Loading…</p>}
          {error && (
            <div className="px-4 sm:px-3">
              <ErrorBanner error={error} />
            </div>
          )}
          {pages.map(s => (
            <Link
              key={s}
              to={`/wiki/${s}`}
              onClick={handlePageClick}
              className={`block px-4 sm:px-3 py-2.5 md:py-1.5 text-sm font-sans truncate ${
                s === currentSlug
                  ? 'bg-warm-sand text-near-black font-medium'
                  : 'text-olive-gray hover:bg-border-cream'
              }`}
            >
              {s}
            </Link>
          ))}
          {!loading && !error && pages.length === 0 && (
            <p className="px-4 sm:px-3 text-xs text-stone-gray font-sans">No pages yet.</p>
          )}
        </aside>
      </div>
    </>
  )
}
