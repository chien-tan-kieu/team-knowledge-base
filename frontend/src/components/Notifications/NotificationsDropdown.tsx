import { useNotificationsStore, selectUnreadCount, type Notification } from '../../stores/notificationsStore'
import { NotificationItem } from './NotificationItem'

interface Props {
  onActivate: (item: Notification) => void
}

export function NotificationsDropdown({ onActivate }: Props) {
  const items = useNotificationsStore(s => s.items)
  const markAllRead = useNotificationsStore(s => s.markAllRead)
  const unread = useNotificationsStore(selectUnreadCount)

  return (
    <div
      role="menu"
      aria-label="Notifications"
      className="w-[360px] bg-surface rounded-xl overflow-hidden"
      style={{ boxShadow: 'var(--shadow-ring), 0 10px 32px rgba(0,0,0,0.08)' }}
    >
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-line-strong/40">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg-muted">
          Notifications
        </span>
        <button
          type="button"
          onClick={markAllRead}
          disabled={unread === 0}
          className="text-[11.5px] text-accent disabled:text-fg-dim disabled:cursor-default hover:underline underline-offset-[3px]"
        >
          Mark all read
        </button>
      </div>
      {items.length === 0 ? (
        <div className="py-8 px-4 text-center text-[13px] text-fg-muted">
          No notifications yet.
        </div>
      ) : (
        <ul className="max-h-[420px] overflow-y-auto">
          {items.map(item => (
            <NotificationItem key={item.id} item={item} onActivate={onActivate} />
          ))}
        </ul>
      )}
    </div>
  )
}
