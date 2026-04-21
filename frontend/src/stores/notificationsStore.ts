import { create } from 'zustand'

export type NotificationKind = 'ingest-success' | 'ingest-failure'

export interface Notification {
  id: string
  kind: NotificationKind
  title: string
  detail?: string
  filename: string
  jobId: string
  createdAt: number
  read: boolean
}

export type PushInput = Omit<Notification, 'id' | 'createdAt' | 'read'>

interface NotificationsState {
  items: Notification[]
  push: (input: PushInput) => void
  markRead: (id: string) => void
  markAllRead: () => void
  remove: (id: string) => void
}

const MAX_ITEMS = 50

export const useNotificationsStore = create<NotificationsState>(set => ({
  items: [],
  push: input =>
    set(state => {
      const next: Notification = {
        ...input,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        read: false,
      }
      const merged = [next, ...state.items]
      return { items: merged.length > MAX_ITEMS ? merged.slice(0, MAX_ITEMS) : merged }
    }),
  markRead: id =>
    set(state => ({
      items: state.items.map(i => (i.id === id ? { ...i, read: !i.read } : i)),
    })),
  markAllRead: () =>
    set(state => ({ items: state.items.map(i => ({ ...i, read: true })) })),
  remove: id => set(state => ({ items: state.items.filter(i => i.id !== id) })),
}))

export function selectUnreadCount(state: NotificationsState): number {
  return state.items.reduce((n, i) => (i.read ? n : n + 1), 0)
}
