import { useNotificationsStore, type Notification } from '../../stores/notificationsStore'
import { formatRelativeTime } from '../../utils/relativeTime'

interface Props {
  item: Notification
  onActivate: (item: Notification) => void
}

export function NotificationItem({ item, onActivate }: Props) {
  const markRead = useNotificationsStore(s => s.markRead)
  const remove = useNotificationsStore(s => s.remove)

  const dotColor = item.read
    ? 'var(--color-line-strong)'
    : item.kind === 'ingest-failure'
      ? 'var(--color-error-crimson)'
      : 'var(--color-accent)'

  return (
    <li
      role="menuitem"
      tabIndex={0}
      onClick={() => onActivate(item)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onActivate(item)
        }
      }}
      className={[
        'group flex items-start gap-2.5 px-3.5 py-2.5 cursor-pointer border-b border-line-strong/40 last:border-b-0',
        item.read ? '' : 'bg-accent/5',
        'hover:bg-sand',
      ].join(' ')}
    >
      <span
        aria-hidden
        className="mt-[7px] w-[7px] h-[7px] rounded-full flex-shrink-0"
        style={{ background: dotColor }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] leading-[1.35] text-fg font-medium truncate">{item.title}</p>
        {item.detail && (
          <p className="text-[11.5px] text-fg-muted truncate mt-0.5">{item.detail}</p>
        )}
        <p className="text-[11px] text-fg-dim mt-0.5 font-mono">
          {formatRelativeTime(item.createdAt)}
        </p>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <button
          type="button"
          aria-label={item.read ? 'Mark as unread' : 'Mark as read'}
          title={item.read ? 'Mark as unread' : 'Mark as read'}
          onClick={e => {
            e.stopPropagation()
            markRead(item.id)
          }}
          className="w-[22px] h-[22px] grid place-items-center rounded-md text-fg-muted hover:bg-elevated hover:text-fg"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Delete notification"
          title="Delete"
          onClick={e => {
            e.stopPropagation()
            remove(item.id)
          }}
          className="w-[22px] h-[22px] grid place-items-center rounded-md text-fg-muted hover:bg-elevated hover:text-fg"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </li>
  )
}
