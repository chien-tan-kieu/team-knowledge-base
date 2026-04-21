import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Notifications } from '../index'
import { useNotificationsStore } from '../../../stores/notificationsStore'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

function renderUnderRouter() {
  return render(
    <MemoryRouter>
      <Notifications />
    </MemoryRouter>
  )
}

beforeEach(() => {
  navigate.mockReset()
  useNotificationsStore.setState({ items: [] })
})

describe('<Notifications />', () => {
  it('does not show a badge when there are no unread items', () => {
    renderUnderRouter()
    expect(screen.queryByTestId('notifications-badge')).toBeNull()
  })

  it('shows a count badge when unread > 0, and "9+" beyond 9', () => {
    const { push } = useNotificationsStore.getState()
    for (let i = 0; i < 3; i++) push({ kind: 'ingest-success', title: `n${i}`, filename: 'a.md', jobId: String(i) })
    renderUnderRouter()
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('3')

    act(() => {
      useNotificationsStore.setState({ items: [] })
      for (let i = 0; i < 15; i++) useNotificationsStore.getState().push({
        kind: 'ingest-success', title: `n${i}`, filename: 'a.md', jobId: String(i),
      })
    })
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('9+')
  })

  it('opens the dropdown when the bell is clicked and closes on Escape', () => {
    useNotificationsStore.getState().push({
      kind: 'ingest-success', title: 'Compiled a.md', filename: 'a.md', jobId: 'j1',
    })
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    expect(screen.getByRole('menu', { name: /notifications/i })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: /notifications/i })).toBeNull()
  })

  it('closes the dropdown on outside pointerdown', () => {
    useNotificationsStore.getState().push({
      kind: 'ingest-success', title: 'Compiled a.md', filename: 'a.md', jobId: 'j1',
    })
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    expect(screen.getByRole('menu', { name: /notifications/i })).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu', { name: /notifications/i })).toBeNull()
  })

  it('shows the empty state when there are no items', () => {
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    expect(screen.getByText(/no notifications yet/i)).toBeInTheDocument()
  })

  it('navigates to /wiki on success row click and marks read', () => {
    useNotificationsStore.getState().push({
      kind: 'ingest-success', title: 'Compiled a.md', filename: 'a.md', jobId: 'j1',
    })
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    fireEvent.click(screen.getByText('Compiled a.md'))
    expect(navigate).toHaveBeenCalledWith('/wiki')
    expect(useNotificationsStore.getState().items[0].read).toBe(true)
  })

  it('does not toggle an already-read item back to unread on activation', () => {
    const { push } = useNotificationsStore.getState()
    push({ kind: 'ingest-success', title: 'Compiled a.md', filename: 'a.md', jobId: 'j1' })
    const id = useNotificationsStore.getState().items[0].id
    useNotificationsStore.getState().markRead(id) // pre-mark as read
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    fireEvent.click(screen.getByText('Compiled a.md'))
    expect(navigate).toHaveBeenCalledWith('/wiki')
    expect(useNotificationsStore.getState().items[0].read).toBe(true)
  })

  it('navigates to /ingest on failure row click and marks read', () => {
    useNotificationsStore.getState().push({
      kind: 'ingest-failure', title: 'Failed to compile b.md', filename: 'b.md', jobId: 'j2', detail: 'boom',
    })
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    fireEvent.click(screen.getByText('Failed to compile b.md'))
    expect(navigate).toHaveBeenCalledWith('/ingest')
    expect(useNotificationsStore.getState().items[0].read).toBe(true)
  })

  it('hover delete button removes without triggering navigation', () => {
    useNotificationsStore.getState().push({
      kind: 'ingest-success', title: 'Compiled a.md', filename: 'a.md', jobId: 'j1',
    })
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    fireEvent.click(screen.getByRole('button', { name: /delete notification/i }))
    expect(navigate).not.toHaveBeenCalled()
    expect(useNotificationsStore.getState().items).toHaveLength(0)
  })

  it('hover mark-read button toggles read state without triggering navigation', () => {
    useNotificationsStore.getState().push({
      kind: 'ingest-success', title: 'Compiled a.md', filename: 'a.md', jobId: 'j1',
    })
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    fireEvent.click(screen.getByRole('button', { name: /mark as read/i }))
    expect(navigate).not.toHaveBeenCalled()
    expect(useNotificationsStore.getState().items[0].read).toBe(true)
  })

  it('"Mark all read" clears the unread count and is disabled at zero', () => {
    const { push } = useNotificationsStore.getState()
    push({ kind: 'ingest-success', title: 'a', filename: 'a.md', jobId: '1' })
    push({ kind: 'ingest-success', title: 'b', filename: 'b.md', jobId: '2' })
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    const markAll = screen.getByRole('button', { name: /mark all read/i })
    expect(markAll).not.toBeDisabled()
    fireEvent.click(markAll)
    expect(useNotificationsStore.getState().items.every(i => i.read)).toBe(true)
    expect(screen.queryByTestId('notifications-badge')).toBeNull()
    expect(markAll).toBeDisabled()
  })
})
