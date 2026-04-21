import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { selectUnreadCount, useNotificationsStore, type Notification } from '../../stores/notificationsStore'
import { NotificationsDropdown } from './NotificationsDropdown'

function badgeLabel(count: number): string {
  return count > 9 ? '9+' : String(count)
}

export function Notifications() {
  const [isOpen, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const unread = useNotificationsStore(selectUnreadCount)
  const markRead = useNotificationsStore(s => s.markRead)

  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    function onPointer(e: PointerEvent) {
      if (!wrapperRef.current) return
      if (e.target instanceof Node && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [isOpen])

  function handleActivate(item: Notification) {
    if (!item.read) markRead(item.id)
    setOpen(false)
    navigate(item.kind === 'ingest-success' ? '/wiki' : '/ingest')
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Notifications"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setOpen(v => !v)}
        className="relative w-9 h-9 grid place-items-center rounded-lg text-fg-muted hover:bg-sand hover:text-fg transition-colors duration-200"
      >
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            data-testid="notifications-badge"
            aria-label={`${unread} unread`}
            className="absolute top-1 right-1 min-w-[14px] h-[14px] px-[3px] text-[9.5px] font-bold bg-accent text-fg-onaccent rounded-full grid place-items-center"
            style={{ boxShadow: '0 0 0 2px var(--color-canvas)' }}
          >
            {badgeLabel(unread)}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-40">
          <NotificationsDropdown onActivate={handleActivate} />
        </div>
      )}
    </div>
  )
}
