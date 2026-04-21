import { useTheme } from '../hooks/useTheme'
import { Notifications } from './Notifications'

interface Props {
  onMobileMenuOpen: () => void
  sidebarCollapsed: boolean
  onSidebarToggle: () => void
}

export function AppHeader({ onMobileMenuOpen, sidebarCollapsed, onSidebarToggle }: Props) {
  const { theme, toggle } = useTheme()

  return (
    <header className="h-14 flex-shrink-0 border-b border-line bg-canvas relative z-30 flex items-center gap-3 px-4 sm:px-5 pt-safe">
      <button
        type="button"
        aria-label="Open navigation"
        className="md:hidden -ml-2 w-10 h-10 grid place-items-center rounded-md text-fg-muted hover:bg-sand"
        onClick={onMobileMenuOpen}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Brand */}
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-6 h-6 inline-grid place-items-center text-accent">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="w-full h-full">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 4h9l3 3v13H6z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 4v3h3" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 11h6M9 15h6" />
          </svg>
        </span>
        <span
          className="font-serif font-medium text-[17px] tracking-tight truncate text-fg"
          style={{ fontVariationSettings: '"opsz" 48' }}
        >
          Knowledge Base
        </span>
        <span className="hidden sm:inline-block w-1 h-1 rounded-full mx-1 bg-line-strong align-middle" aria-hidden />
        <span className="hidden sm:inline text-[11px] tracking-[0.12em] uppercase text-fg-dim">
          Scholar's Room
        </span>
      </div>

      <div className="flex-1" />

      {/* Command palette trigger (placeholder) */}
      <button
        type="button"
        aria-label="Search"
        className="hidden sm:grid grid-cols-[16px_1fr_auto] items-center gap-2.5 w-full max-w-[420px] px-3 py-1.5 rounded-[10px] text-[13px] bg-surface text-fg-dim transition-[box-shadow,background] duration-200 hover:bg-elevated"
        style={{ boxShadow: 'var(--shadow-ring)' }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="m20 20-3.5-3.5" />
        </svg>
        <span className="text-left truncate">Search pages, ask anything…</span>
        <kbd className="text-[10.5px] font-medium font-mono px-1.5 py-0.5 rounded bg-elevated text-fg-muted border border-line-strong">
          ⌘K
        </kbd>
      </button>

      <div className="flex-1 hidden sm:block" />

      {/* Right cluster */}
      <div className="flex items-center gap-1">
        <Notifications />

        <button
          type="button"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onSidebarToggle}
          className="hidden md:grid relative w-9 h-9 place-items-center rounded-lg text-fg-muted hover:bg-sand hover:text-fg transition-colors duration-200"
        >
          <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path strokeLinecap="round" d="M9 4v16" />
            {sidebarCollapsed ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="m5 10 2 2-2 2" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="m7 10-2 2 2 2" />
            )}
          </svg>
        </button>

        <button
          type="button"
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          onClick={toggle}
          className="relative w-9 h-9 grid place-items-center rounded-lg text-fg-muted hover:bg-sand hover:text-fg transition-colors duration-200"
        >
          {theme === 'light' ? (
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
            </svg>
          )}
        </button>

        <span
          className="hidden sm:grid ml-1 w-7 h-7 rounded-full place-items-center font-serif font-medium text-[12.5px] bg-accent text-fg-onaccent"
          style={{
            boxShadow:
              '0 0 0 2px var(--color-canvas), 0 0 0 3px var(--color-line-strong)',
          }}
          aria-hidden
        >
          K
        </span>
      </div>
    </header>
  )
}
