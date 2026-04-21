import { beforeEach, describe, expect, it } from 'vitest'
import { useNotificationsStore, selectUnreadCount } from '../notificationsStore'

beforeEach(() => {
  useNotificationsStore.setState({ items: [] })
})

describe('notificationsStore', () => {
  it('push prepends an item with generated id/createdAt and read=false', () => {
    useNotificationsStore.getState().push({
      kind: 'ingest-success',
      title: 'Compiled a.md',
      filename: 'a.md',
      jobId: 'job-1',
    })
    const items = useNotificationsStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].read).toBe(false)
    expect(items[0].id).toEqual(expect.any(String))
    expect(items[0].createdAt).toEqual(expect.any(Number))
    expect(items[0].kind).toBe('ingest-success')
  })

  it('push prepends newer items above older ones', () => {
    const { push } = useNotificationsStore.getState()
    push({ kind: 'ingest-success', title: 'first', filename: 'a.md', jobId: '1' })
    push({ kind: 'ingest-failure', title: 'second', filename: 'b.md', jobId: '2' })
    const titles = useNotificationsStore.getState().items.map(i => i.title)
    expect(titles).toEqual(['second', 'first'])
  })

  it('caps the list at 50 items, dropping the oldest', () => {
    const { push } = useNotificationsStore.getState()
    for (let i = 0; i < 51; i++) {
      push({ kind: 'ingest-success', title: `n${i}`, filename: 'x.md', jobId: String(i) })
    }
    const items = useNotificationsStore.getState().items
    expect(items).toHaveLength(50)
    expect(items[0].title).toBe('n50')
    expect(items[items.length - 1].title).toBe('n1')
  })

  it('markRead flips one item, markAllRead flips all', () => {
    const { push, markRead, markAllRead } = useNotificationsStore.getState()
    push({ kind: 'ingest-success', title: 'a', filename: 'a.md', jobId: '1' })
    push({ kind: 'ingest-success', title: 'b', filename: 'b.md', jobId: '2' })
    const [second, first] = useNotificationsStore.getState().items
    markRead(second.id)
    expect(useNotificationsStore.getState().items.find(i => i.id === second.id)?.read).toBe(true)
    expect(useNotificationsStore.getState().items.find(i => i.id === first.id)?.read).toBe(false)
    markAllRead()
    expect(useNotificationsStore.getState().items.every(i => i.read)).toBe(true)
  })

  it('markRead toggles: read=true on an unread item, read=false on a read item', () => {
    const { push, markRead } = useNotificationsStore.getState()
    push({ kind: 'ingest-success', title: 'a', filename: 'a.md', jobId: '1' })
    const { id } = useNotificationsStore.getState().items[0]
    markRead(id)
    expect(useNotificationsStore.getState().items[0].read).toBe(true)
    markRead(id)
    expect(useNotificationsStore.getState().items[0].read).toBe(false)
  })

  it('remove deletes by id', () => {
    const { push, remove } = useNotificationsStore.getState()
    push({ kind: 'ingest-success', title: 'a', filename: 'a.md', jobId: '1' })
    const { id } = useNotificationsStore.getState().items[0]
    remove(id)
    expect(useNotificationsStore.getState().items).toHaveLength(0)
  })

  it('selectUnreadCount returns the count of unread items', () => {
    const { push, markRead } = useNotificationsStore.getState()
    push({ kind: 'ingest-success', title: 'a', filename: 'a.md', jobId: '1' })
    push({ kind: 'ingest-success', title: 'b', filename: 'b.md', jobId: '2' })
    expect(selectUnreadCount(useNotificationsStore.getState())).toBe(2)
    markRead(useNotificationsStore.getState().items[0].id)
    expect(selectUnreadCount(useNotificationsStore.getState())).toBe(1)
  })
})
