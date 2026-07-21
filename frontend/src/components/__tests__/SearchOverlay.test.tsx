import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SearchOverlay } from '../SearchOverlay'
import * as api from '../../lib/api'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

const sendMock = vi.fn()
vi.mock('../../stores/chatStore', () => ({
  useChatStore: { getState: () => ({ send: sendMock }) },
}))

function renderOverlay() {
  return render(
    <MemoryRouter>
      <SearchOverlay open onClose={() => {}} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  navigateMock.mockReset()
  sendMock.mockReset()
  vi.restoreAllMocks()
})

describe('SearchOverlay', () => {
  it('renders page results after typing', async () => {
    vi.spyOn(api, 'getSearchResults').mockResolvedValue([
      { slug: 'deploy', title: 'Deploy Process', snippet: '…deploy to production…' },
    ])
    renderOverlay()
    await userEvent.type(screen.getByRole('searchbox'), 'deploy')
    expect(await screen.findByText('Deploy Process')).toBeInTheDocument()
  })

  it('always shows an Ask row for a non-empty query', async () => {
    vi.spyOn(api, 'getSearchResults').mockResolvedValue([])
    renderOverlay()
    await userEvent.type(screen.getByRole('searchbox'), 'anything')
    expect(await screen.findByText(/Ask:/)).toBeInTheDocument()
  })

  it('Ask row navigates to / and sends the query to chat', async () => {
    vi.spyOn(api, 'getSearchResults').mockResolvedValue([])
    renderOverlay()
    await userEvent.type(screen.getByRole('searchbox'), 'how do we deploy')
    const ask = await screen.findByText(/Ask:/)
    await userEvent.click(ask)
    expect(navigateMock).toHaveBeenCalledWith('/')
    expect(sendMock).toHaveBeenCalledWith('how do we deploy')
  })

  it('clicking a page result navigates to that wiki page', async () => {
    vi.spyOn(api, 'getSearchResults').mockResolvedValue([
      { slug: 'deploy', title: 'Deploy Process', snippet: '…' },
    ])
    renderOverlay()
    await userEvent.type(screen.getByRole('searchbox'), 'deploy')
    await userEvent.click(await screen.findByText('Deploy Process'))
    expect(navigateMock).toHaveBeenCalledWith('/wiki/deploy')
  })

  it('ArrowDown + Enter activates the first page result', async () => {
    vi.spyOn(api, 'getSearchResults').mockResolvedValue([
      { slug: 'deploy', title: 'Deploy Process', snippet: '…' },
    ])
    renderOverlay()
    const input = screen.getByRole('searchbox')
    await userEvent.type(input, 'deploy')
    await screen.findByText('Deploy Process')
    // Default highlight is the Ask row; ArrowDown moves to the first page row.
    await userEvent.type(input, '{ArrowDown}{Enter}')
    expect(navigateMock).toHaveBeenCalledWith('/wiki/deploy')
  })

  it('shows an error banner when the search request fails', async () => {
    vi.spyOn(api, 'getSearchResults').mockRejectedValue(
      new api.ApiError({ code: 'INTERNAL_ERROR', message: 'boom', requestId: null, status: 500 }),
    )
    renderOverlay()
    await userEvent.type(screen.getByRole('searchbox'), 'deploy')
    expect(await screen.findByText(/boom|went wrong|failed/i)).toBeInTheDocument()
  })
})
