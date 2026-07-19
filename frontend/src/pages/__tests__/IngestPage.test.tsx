import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IngestPage } from '../IngestPage'
import { useIngestStore } from '../../stores/ingestStore'

beforeEach(() => {
  vi.restoreAllMocks()
  useIngestStore.setState({ job: null, uploading: false, error: null })
})

function jsonRes(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response
}

function renderPage() {
  return render(<IngestPage />)
}

describe('IngestPage sync vault', () => {
  it('renders the Sync vault button', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /sync vault/i })).toBeInTheDocument()
  })

  it('calls POST /api/ingest/sync when Sync vault button is clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ jobs: [] }))
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /sync vault/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/ingest/sync',
        expect.objectContaining({ method: 'POST' })
      )
    )
  })

  it('auto-triggers sync when ingest job transitions to done', async () => {
    const syncFetch = vi.fn().mockResolvedValue(jsonRes({ jobs: [] }))
    vi.stubGlobal('fetch', syncFetch)

    useIngestStore.setState({
      job: { job_id: 'j1', filename: 'doc.md', status: 'done', error: null },
      uploading: false,
      error: null,
    })

    renderPage()

    await waitFor(() =>
      expect(syncFetch).toHaveBeenCalledWith(
        '/api/ingest/sync',
        expect.objectContaining({ method: 'POST' })
      )
    )
  })
})
