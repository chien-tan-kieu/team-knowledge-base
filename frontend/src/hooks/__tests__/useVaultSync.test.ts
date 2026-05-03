import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useVaultSync } from '../useVaultSync'

beforeEach(() => vi.restoreAllMocks())

function jsonRes(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response
}

describe('useVaultSync', () => {
  it('starts with empty syncJobs and syncing=false', () => {
    const { result } = renderHook(() => useVaultSync())
    expect(result.current.syncJobs).toEqual([])
    expect(result.current.syncing).toBe(false)
  })

  it('sets syncing=true while running, false after completion', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes({ jobs: [{ job_id: 'j1', filename: 'a.md' }] }))
      .mockResolvedValueOnce(jsonRes({ job_id: 'j1', filename: 'a.md', status: 'done', error: null }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useVaultSync())

    act(() => { result.current.triggerSync() })
    expect(result.current.syncing).toBe(true)

    // Flush syncVault() promise so setInterval is registered
    await act(async () => {})
    // Fire the interval and flush the async polling callback
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    // Switch to real timers so waitFor can poll normally
    vi.useRealTimers()
    await waitFor(() => expect(result.current.syncing).toBe(false))
  })

  it('populates syncJobs with filename and terminal status', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonRes({ jobs: [{ job_id: 'j1', filename: 'guide.md' }] }))
      .mockResolvedValueOnce(jsonRes({ job_id: 'j1', filename: 'guide.md', status: 'done', error: null }))
    )

    const { result } = renderHook(() => useVaultSync())
    act(() => { result.current.triggerSync() })

    // Flush syncVault() promise so setInterval is registered
    await act(async () => {})
    // Fire the interval and flush the async polling callback
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    // Switch to real timers so waitFor can poll normally
    vi.useRealTimers()
    await waitFor(() => expect(result.current.syncJobs[0]?.status).toBe('done'))
    expect(result.current.syncJobs[0].filename).toBe('guide.md')
  })

  it('returns empty syncJobs and does not set syncing when no jobs returned', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ jobs: [] })))

    const { result } = renderHook(() => useVaultSync())
    await act(async () => { await result.current.triggerSync() })

    expect(result.current.syncJobs).toEqual([])
    expect(result.current.syncing).toBe(false)
  })
})
