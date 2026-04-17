import { NavLink } from 'react-router-dom'
import { useWikiPages } from '../hooks/useWiki'

interface Props {
  open: boolean
  onNavigate: () => void
}

const LINK_CLASSES = 'mx-1 px-3 py-2.5 md:py-1.5 rounded-md text-sm font-sans'

export function Sidebar({ open, onNavigate }: Props) {
  const { pages } = useWikiPages()

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 w-64 bg-ivory border-r border-border-cream flex flex-col py-4 gap-1 overflow-y-auto pb-safe transition-transform md:static md:z-auto md:w-55 md:translate-x-0 ${
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
          `${LINK_CLASSES} ${
            isActive
              ? 'bg-warm-sand text-near-black font-medium'
              : 'text-olive-gray hover:bg-border-cream'
          }`
        }
      >
        Chat
      </NavLink>

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

      {pages.length > 0 && (
        <>
          <span className="px-3 pt-3 pb-1 text-xs font-medium text-stone-gray uppercase tracking-widest font-sans">
            Wiki
          </span>
          {pages.map(slug => (
            <NavLink
              key={slug}
              to={`/wiki/${slug}`}
              onClick={onNavigate}
              className={({ isActive }) =>
                `${LINK_CLASSES} truncate ${
                  isActive
                    ? 'bg-warm-sand text-near-black font-medium'
                    : 'text-olive-gray hover:bg-border-cream'
                }`
              }
            >
              {slug}
            </NavLink>
          ))}
        </>
      )}
    </aside>
  )
}
