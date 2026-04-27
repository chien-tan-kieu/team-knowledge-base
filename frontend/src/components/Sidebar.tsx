import { useState, useEffect } from 'react'
import { Link, NavLink, useLocation, useParams } from 'react-router-dom'
import { useWikiPages } from '../hooks/useWiki'
import type { useResizableSidebar } from '../hooks/useResizableSidebar'

type ResizeState = ReturnType<typeof useResizableSidebar>

interface Props {
  open: boolean
  onNavigate: () => void
  onWikiToggle: () => void
  wikiDrawerOpen: boolean
  resize: ResizeState
}

function NavIcon({ name }: { name: 'chat' | 'wiki' | 'ingest' }) {
  const common = 'w-[18px] h-[18px] flex-shrink-0'
  if (name === 'chat') {
    return (
      <svg className={common} fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12a9 9 0 0 1-9 9 9 9 0 0 1-4.3-1.1L3 21l1.1-4.7A9 9 0 1 1 21 12Z" />
      </svg>
    )
  }
  if (name === 'wiki') {
    return (
      <svg className={common} fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
      </svg>
    )
  }
  return (
    <svg className={common} fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16M4 12h16" />
    </svg>
  )
}

export function Sidebar({ open, onNavigate, onWikiToggle, wikiDrawerOpen, resize }: Props) {
  const location = useLocation()
  const { slug: currentSlug } = useParams<{ slug?: string }>()
  const { pages } = useWikiPages()
  const { collapsed, onHandlePointerDown, onHandleKeyDown, toggleCollapsed } = resize
  const [wikiExpanded, setWikiExpanded] = useState(false)
  // On mobile (open=true the sidebar is a drawer), always render fully expanded regardless
  // of the desktop collapsed state stored in localStorage.
  const visuallyCollapsed = collapsed && !open

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting accordion state when sidebar closes is the canonical pattern.
    if (!open) setWikiExpanded(false)
  }, [open])

  const wikiActive = wikiDrawerOpen || wikiExpanded || location.pathname.startsWith('/wiki')

  // Always-rendered grid layout; text fades in/out rather than hard-mounting.
  // Collapsing: fade out fast (150ms), no delay — text disappears as sidebar starts closing.
  // Expanding: fade in (200ms) after a short delay (120ms) — text appears once sidebar has opened.
  const textFade = visuallyCollapsed
    ? 'opacity-0 transition-opacity duration-150 ease-out'
    : 'opacity-100 transition-opacity duration-200 ease-out delay-[120ms]'

  const navBase =
    'w-full grid grid-cols-[18px_1fr_auto] items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13.5px] font-medium transition-[background,color] duration-150 relative text-left overflow-hidden'

  function linkClasses(isActive: boolean) {
    return [
      navBase,
      isActive
        ? 'bg-sand text-fg'
        : 'text-fg-muted hover:bg-line hover:text-fg',
    ].join(' ')
  }

  return (
    <aside
      className={[
        'fixed md:relative inset-y-0 left-0 z-40 flex flex-col gap-1 pt-3 pb-3 px-2.5 bg-canvas border-r border-line overflow-y-auto overflow-x-hidden pb-safe',
        open ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        collapsed ? 'md:items-center md:px-1.5' : '',
      ].join(' ')}
      style={{ width: open && collapsed ? `${resize.width}px` : 'var(--sidebar-w, 260px)', minWidth: 0 }}
      aria-label="Primary"
    >
      {/* Section label — height collapses smoothly rather than popping out */}
      <div className={`overflow-hidden transition-[max-height,opacity] ease-out ${
        visuallyCollapsed
          ? 'max-h-0 opacity-0 duration-150'
          : 'max-h-[44px] opacity-100 duration-200 delay-[120ms]'
      }`}>
        <span className="px-2.5 pt-2 pb-1 text-[10.5px] font-medium text-fg-dim uppercase tracking-[0.12em] flex items-center gap-2">
          Navigate
          <span
            className="flex-1 mt-px border-t border-dashed"
            style={{ borderColor: 'var(--color-line)' }}
          />
        </span>
      </div>

      {/* Chat */}
      <NavLink
        to="/"
        end
        onClick={onNavigate}
        title={visuallyCollapsed ? 'Chat' : undefined}
        data-label="Chat"
        className={({ isActive }) => linkClasses(isActive)}
        style={({ isActive }) => (isActive ? { boxShadow: 'var(--shadow-ring)' } : undefined)}
      >
        <NavIcon name="chat" />
        <span className={`whitespace-nowrap ${textFade}`} aria-hidden={visuallyCollapsed}>Chat</span>
      </NavLink>

      {/* Wiki — button, opens drawer on desktop / inline list on mobile */}
      <button
        type="button"
        onClick={() => {
          if (open) {
            setWikiExpanded(e => !e)
          } else {
            onWikiToggle()
          }
        }}
        aria-expanded={wikiExpanded || wikiDrawerOpen}
        title={visuallyCollapsed ? 'Wiki' : undefined}
        data-label="Wiki"
        className={linkClasses(wikiActive)}
        style={wikiActive ? { boxShadow: 'var(--shadow-ring)' } : undefined}
      >
        <NavIcon name="wiki" />
        <span className={`whitespace-nowrap ${textFade}`} aria-hidden={visuallyCollapsed}>Wiki</span>
        <span
          className={`text-[11px] font-medium text-fg-dim bg-canvas px-[7px] py-[1px] rounded-full border border-line tabular-nums transition-opacity ease-out ${
            visuallyCollapsed ? 'opacity-0 duration-150' : 'opacity-100 duration-200 delay-[120ms]'
          }`}
          aria-hidden={visuallyCollapsed}
        >
          {pages.length}
        </span>
      </button>

      {/* Mobile inline wiki list — shown when expanded; desktop uses WikiDrawer */}
      {wikiExpanded && (
        <nav className="md:hidden flex flex-col gap-px py-1">
          {pages.map(s => {
            const active = s === currentSlug
            return (
              <Link
                key={s}
                to={`/wiki/${s}`}
                onClick={onNavigate}
                className={[
                  'grid grid-cols-[8px_1fr] items-center gap-2',
                  'pl-[34px] pr-2.5 py-[5px] rounded-md',
                  'font-mono text-[12.5px] tracking-tight',
                  active
                    ? 'bg-sand text-fg'
                    : 'text-fg-muted hover:bg-line hover:text-fg',
                ].join(' ')}
                style={active ? { boxShadow: 'var(--shadow-ring)' } : undefined}
              >
                <span
                  className="inline-block w-1 h-1 rounded-full flex-shrink-0"
                  style={{
                    background: active ? 'var(--color-accent)' : 'var(--color-line-strong)',
                  }}
                  aria-hidden
                />
                <span className="truncate">{s}</span>
              </Link>
            )
          })}
          {pages.length === 0 && (
            <p className="pl-[34px] pr-2.5 py-2 text-xs text-fg-dim font-sans">
              No pages yet.
            </p>
          )}
        </nav>
      )}

      {/* Ingest */}
      <NavLink
        to="/ingest"
        onClick={onNavigate}
        title={visuallyCollapsed ? 'Add Document' : undefined}
        data-label="Add Document"
        className={({ isActive }) => linkClasses(isActive)}
        style={({ isActive }) => (isActive ? { boxShadow: 'var(--shadow-ring)' } : undefined)}
      >
        <NavIcon name="ingest" />
        <span className={`whitespace-nowrap ${textFade}`} aria-hidden={visuallyCollapsed}>Add Document</span>
      </NavLink>

      {/* Footer: stats card — collapses smoothly rather than popping out */}
      <div
        className={`overflow-hidden transition-[max-height,opacity] ease-out ${
          visuallyCollapsed
            ? 'max-h-0 opacity-0 duration-150'
            : 'max-h-[160px] opacity-100 duration-200 delay-[120ms]'
        }`}
        style={{ marginTop: 'auto' }}
      >
        <div className="p-2">
          <div
            className="bg-surface rounded-xl px-3.5 py-3 flex flex-col gap-1.5"
            style={{ boxShadow: 'var(--shadow-ring)' }}
          >
            <div
              className="flex justify-between items-center pb-2 mb-1 border-b border-dashed"
              style={{ borderColor: 'var(--color-line-strong)' }}
            >
              <span
                className="font-serif font-medium text-[13px] text-fg"
                style={{ fontVariationSettings: '"opsz" 12' }}
              >
                Your library
              </span>
              <span
                className="inline-flex items-center gap-1.5 text-[10.5px] text-fg-dim"
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{
                    background: '#76a35c',
                    boxShadow: '0 0 0 3px rgba(118,163,92,0.18)',
                  }}
                />
                live
              </span>
            </div>
            <div className="flex justify-between text-[12px] text-fg-muted">
              <span>Pages</span>
              <strong className="text-fg font-medium tabular-nums">{pages.length}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Drag-to-resize handle — desktop only */}
      <button
        type="button"
        aria-label={collapsed ? 'Expand sidebar' : 'Resize or collapse sidebar'}
        aria-orientation="vertical"
        onPointerDown={onHandlePointerDown}
        onDoubleClick={toggleCollapsed}
        onKeyDown={onHandleKeyDown}
        className="hidden md:block absolute top-0 bottom-0 -right-[3px] w-[7px] cursor-col-resize z-[15] group"
        style={{ touchAction: 'none' }}
      >
        <span
          aria-hidden
          className="absolute left-[3px] top-0 h-full w-px bg-transparent group-hover:bg-[var(--color-line-strong)] transition-colors duration-150"
        />
        <span
          aria-hidden
          className="absolute left-[2px] top-1/2 -translate-y-1/2 w-[3px] h-9 rounded-full bg-transparent group-hover:bg-[var(--color-accent)] transition-[background,transform] duration-200 group-hover:scale-y-110"
        />
      </button>
    </aside>
  )
}
