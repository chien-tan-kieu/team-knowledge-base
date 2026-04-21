import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIngestStore } from '../ingestStore'
import { useNotificationsStore } from '../notificationsStore'
import { ApiError } from '../../lib/api'

function jsonRes(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response
}

beforeEach(() => {
  vi.useFakeTimers()
  useIngestStore.setState({ job: null, uploading: false, error: null })
  useNotificationsStore.setState({ items: [] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ingestStore.upload', () => {
  it('sets uploading and stores the returned job', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'pending', error: null })
    ))
    const p = useIngestStore.getState().upload(new File(['x'], 'a.md'))
    expect(useIngestStore.getState().uploading).toBe(true)
    await p
    expect(useIngestStore.getState().uploading).toBe(false)
    expect(useIngestStore.getState().job).toEqual({
      job_id: 'j1', filename: 'a.md', status: 'pending', error: null,
    })
  })

  it('pushes a success notification when polling sees status=done', async () => {
    const responses = [
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'pending', error: null }),
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'running', error: null }),
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'done', error: null }),
    ]
    let i = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? responses[responses.length - 1])))

    await useIngestStore.getState().upload(new File(['x'], 'a.md'))
    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(1500)

    expect(useIngestStore.getState().job?.status).toBe('done')
    const notifs = useNotificationsStore.getState().items
    expect(notifs).toHaveLength(1)
    expect(notifs[0].kind).toBe('ingest-success')
    expect(notifs[0].filename).toBe('a.md')
    expect(notifs[0].jobId).toBe('j1')
  })

  it('pushes a failure notification when polling sees status=failed', async () => {
    const responses = [
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'pending', error: null }),
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'failed', error: 'boom' }),
    ]
    let i = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? responses[responses.length - 1])))

    await useIngestStore.getState().upload(new File(['x'], 'a.md'))
    await vi.advanceTimersByTimeAsync(1500)

    const notifs = useNotificationsStore.getState().items
    expect(notifs).toHaveLength(1)
    expect(notifs[0].kind).toBe('ingest-failure')
    expect(notifs[0].detail).toBe('boom')
  })

  it('fires exactly one notification even if polling continues past terminal status', async () => {
    const responses = [
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'pending', error: null }),
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'done', error: null }),
    ]
    let i = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(responses[Math.min(i++, responses.length - 1)])))

    await useIngestStore.getState().upload(new File(['x'], 'a.md'))
    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(5000)

    expect(useNotificationsStore.getState().items).toHaveLength(1)
  })

  it('does not re-notify if polling observes the same terminal status twice', async () => {
    // POST returns pending; all subsequent GETs return done.
    // Simulates tick B landing after tick A has already set state to done.
    let callCount = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      callCount++
      const status = callCount === 1 ? 'pending' : 'done'
      return Promise.resolve(jsonRes({ job_id: 'j1', filename: 'a.md', status, error: null }))
    }))
    await useIngestStore.getState().upload(new File(['x'], 'a.md'))
    // First poll tick: pending → done, triggers notification #1.
    await vi.advanceTimersByTimeAsync(1500)
    // Second poll tick: done → done, guard should suppress duplicate.
    await vi.advanceTimersByTimeAsync(1500)
    expect(useNotificationsStore.getState().items).toHaveLength(1)
  })

  it('treats a poll-time network error as failure', async () => {
    const postRes = jsonRes({ job_id: 'j1', filename: 'a.md', status: 'pending', error: null })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(postRes)
      .mockRejectedValueOnce(new TypeError('network down'))
    vi.stubGlobal('fetch', fetchMock)

    await useIngestStore.getState().upload(new File(['x'], 'a.md'))
    await vi.advanceTimersByTimeAsync(1500)

    expect(useIngestStore.getState().job?.status).toBe('failed')
    expect(useIngestStore.getState().error).toBeInstanceOf(ApiError)
    const notifs = useNotificationsStore.getState().items
    expect(notifs).toHaveLength(1)
    expect(notifs[0].kind).toBe('ingest-failure')
  })

  it('aborts the previous poll loop when a new upload starts', async () => {
    const responses = [
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'pending', error: null }),
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'running', error: null }),
      jsonRes({ job_id: 'j2', filename: 'b.md', status: 'pending', error: null }),
      jsonRes({ job_id: 'j2', filename: 'b.md', status: 'done', error: null }),
    ]
    let i = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? responses[responses.length - 1])))

    await useIngestStore.getState().upload(new File(['x'], 'a.md'))
    await vi.advanceTimersByTimeAsync(1500) // j1 → running
    await useIngestStore.getState().upload(new File(['y'], 'b.md'))
    await vi.advanceTimersByTimeAsync(1500) // j2 → done

    const notifs = useNotificationsStore.getState().items
    expect(notifs).toHaveLength(1)
    expect(notifs[0].filename).toBe('b.md')
  })

  it('exposes ApiError on the store when the initial upload POST fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ code: 'VALIDATION_ERROR', message: 'bad file', request_id: null }, false, 422),
    ))
    await useIngestStore.getState().upload(new File(['x'], 'x.md'))
    expect(useIngestStore.getState().error).toBeInstanceOf(ApiError)
    expect(useIngestStore.getState().error?.code).toBe('VALIDATION_ERROR')
    expect(useIngestStore.getState().job).toBeNull()
  })
})
