import { NavLink } from 'react-router-dom'
import { useWikiPages } from '../hooks/useWiki'

export function Sidebar() {
  const { pages } = useWikiPages()

  return (
    <aside className="w-55 bg-ivory border-r border-border-cream flex flex-col py-4 gap-1 overflow-y-auto">
      <span className="px-3 py-1 text-xs font-medium text-stone-gray uppercase tracking-widest font-sans">
        Navigate
      </span>

      <NavLink
        to="/"
        className={({ isActive }) =>
          `mx-1 px-3 py-1.5 rounded-md text-sm font-sans ${
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
        className={({ isActive }) =>
          `mx-1 px-3 py-1.5 rounded-md text-sm font-sans ${
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
              className={({ isActive }) =>
                `mx-1 px-3 py-1.5 rounded-md text-sm font-sans truncate ${
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
