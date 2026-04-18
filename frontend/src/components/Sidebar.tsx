import { NavLink, useLocation } from 'react-router-dom'

interface Props {
  open: boolean
  onNavigate: () => void
  onWikiToggle: () => void
  wikiDrawerOpen: boolean
}

const LINK_CLASSES = 'mx-1 px-3 py-2.5 md:py-1.5 rounded-md text-sm font-sans'

export function Sidebar({ open, onNavigate, onWikiToggle, wikiDrawerOpen }: Props) {
  const location = useLocation()
  const wikiActive = wikiDrawerOpen || location.pathname.startsWith('/wiki')

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 w-64 bg-ivory border-r border-border-cream flex flex-col py-4 gap-1 overflow-y-auto pb-safe transition-transform duration-200 ease-out md:relative md:z-50 md:w-55 md:translate-x-0 md:transition-none ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <span className="px-3 py-1 text-xs font-medium text-stone-gray uppercase tracking-widest font-sans">
        Navigate
      </span>

      <NavLink
        to="/"
        onClick={onNavigate}
        className={({ isActive }) =>
          `${LINK_CLASSES} flex items-center gap-2 ${
            isActive
              ? 'bg-warm-sand text-near-black font-medium'
              : 'text-olive-gray hover:bg-border-cream'
          }`
        }
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12a9 9 0 0 1-9 9 9 9 0 0 1-4.3-1.1L3 21l1.1-4.7A9 9 0 1 1 21 12Z" />
        </svg>
        Chat
      </NavLink>

      <button
        type="button"
        onClick={onWikiToggle}
        aria-expanded={wikiDrawerOpen}
        className={`${LINK_CLASSES} flex items-center gap-2 text-left ${
          wikiActive
            ? 'bg-warm-sand text-near-black font-medium'
            : 'text-olive-gray hover:bg-border-cream'
        }`}
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
        </svg>
        Wiki
      </button>

      <NavLink
        to="/ingest"
        onClick={onNavigate}
        className={({ isActive }) =>
          `${LINK_CLASSES} ${
            isActive
              ? 'bg-warm-sand text-near-black font-medium'
              : 'text-olive-gray hover:bg-border-cream'
          }`
        }
      >
        + Add Document
      </NavLink>
    </aside>
  )
}
