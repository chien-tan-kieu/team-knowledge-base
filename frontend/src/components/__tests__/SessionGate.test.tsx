import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionGate } from '../SessionGate'
import { resetSessionPromise } from '../../lib/api'

describe('SessionGate', () => {
  beforeEach(() => {
    resetSessionPromise()
    vi.restoreAllMocks()
  })

  it('shows loading then renders children on successful bootstrap', async () => {
    const ok = { ok: true, status: 204, headers: new Headers(), json: async () => ({}) } as unknown as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok))

    render(
      <SessionGate>
        <div>hello</div>
      </SessionGate>,
    )

    expect(screen.getByText(/signing in/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('hello')).toBeInTheDocument())
  })

  it('shows ErrorBanner with retry on failure', async () => {
    const fail = {
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ code: 'UNAUTHENTICATED', message: 'Session required.', request_id: null }),
    } as unknown as Response
    const ok = { ok: true, status: 204, headers: new Headers(), json: async () => ({}) } as unknown as Response
    const fetchMock = vi.fn().mockResolvedValueOnce(fail).mockResolvedValueOnce(ok)
    vi.stubGlobal('fetch', fetchMock)

    render(
      <SessionGate>
        <div>hello</div>
      </SessionGate>,
    )

    await waitFor(() => expect(screen.getByText('Session required.')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(screen.getByText('hello')).toBeInTheDocument())
  })
})
