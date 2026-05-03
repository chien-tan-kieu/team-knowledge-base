import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getWikiPages, getWikiPage, ingestFile, ApiError, ensureSession, resetSessionPromise, syncVault } from '../api'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('getWikiPages', () => {
  it('fetches page slugs from /api/wiki', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pages: ['deploy-process', 'onboarding'] }),
    }))
    const pages = await getWikiPages()
    expect(pages).toEqual(['deploy-process', 'onboarding'])
    expect(fetch).toHaveBeenCalledWith('/api/wiki', { credentials: 'include' })
  })
})

describe('getWikiPage', () => {
  it('fetches a single wiki page by slug', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ slug: 'deploy-process', content: '# Deploy' }),
    }))
    const page = await getWikiPage('deploy-process')
    expect(page.slug).toBe('deploy-process')
    expect(fetch).toHaveBeenCalledWith('/api/wiki/deploy-process', { credentials: 'include' })
  })

  it('throws on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(getWikiPage('missing')).rejects.toThrow()
  })
})

describe('ingestFile', () => {
  it('posts file and returns job_id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: 'abc-123', status: 'pending' }),
    }))
    const job = await ingestFile(new File(['# Doc'], 'doc.md'))
    expect(job.job_id).toBe('abc-123')
    expect(fetch).toHaveBeenCalledWith('/api/ingest', expect.objectContaining({ method: 'POST' }))
  })
})

describe('ApiError', () => {
  it('is an Error subclass with fields', () => {
    const err = new ApiError({
      code: 'NOT_FOUND',
      message: 'Job not found.',
      requestId: '01H',
      status: 404,
    })
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('Job not found.')
    expect(err.requestId).toBe('01H')
    expect(err.status).toBe(404)
    expect(err.name).toBe('ApiError')
  })
})

function mockFetchOnce(init: { ok: boolean; status?: number; body?: unknown; headers?: Record<string, string> }) {
  const res = {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    headers: new Headers(init.headers ?? {}),
    json: async () => init.body,
  } as unknown as Response
  return vi.fn().mockResolvedValueOnce(res)
}

describe('fetchJson', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('sends credentials: include on every request', async () => {
    const fetchMock = mockFetchOnce({ ok: true, body: { pages: [] } })
    vi.stubGlobal('fetch', fetchMock)

    await getWikiPages()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1] ?? {}
    expect(init.credentials).toBe('include')
  })

  it('parses flat error body into ApiError', async () => {
    const fetchMock = mockFetchOnce({
      ok: false,
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Page not found.', request_id: '01H' },
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getWikiPages()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'NOT_FOUND',
      message: 'Page not found.',
      requestId: '01H',
      status: 404,
    })
  })

  it('falls back to synthetic INTERNAL_ERROR when body is not JSON', async () => {
    const res = {
      ok: false,
      status: 502,
      headers: new Headers({ 'X-Request-ID': '01HXYZ' }),
      json: async () => {
        throw new Error('not json')
      },
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(res))

    await expect(getWikiPages()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INTERNAL_ERROR',
      status: 502,
      requestId: '01HXYZ',
    })
  })
})

describe('ensureSession', () => {
  beforeEach(() => {
    resetSessionPromise()
    vi.restoreAllMocks()
  })

  it('calls /api/auth/session once for concurrent callers', async () => {
    const res = { ok: true, status: 204, headers: new Headers(), json: async () => ({}) } as unknown as Response
    const fetchMock = vi.fn().mockResolvedValue(res)
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([ensureSession(), ensureSession(), ensureSession()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/session')
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe('include')
  })

  it('throws ApiError on failure and allows retry after reset', async () => {
    const failRes = {
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ code: 'UNAUTHENTICATED', message: 'nope', request_id: null }),
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(failRes))

    await expect(ensureSession()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })

    resetSessionPromise()

    const okRes = { ok: true, status: 204, headers: new Headers(), json: async () => ({}) } as unknown as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okRes))

    await expect(ensureSession()).resolves.toBeUndefined()
  })
})

describe('syncVault', () => {
  it('POSTs to /api/ingest/sync and returns jobs list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jobs: [{ job_id: 'abc', filename: 'guide.md' }] }),
    }))
    const { jobs } = await syncVault()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].filename).toBe('guide.md')
    expect(fetch).toHaveBeenCalledWith(
      '/api/ingest/sync',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws ApiError on non-ok response', async () => {
    const res = {
      ok: false,
      status: 500,
      headers: new Headers(),
      json: async () => ({ code: 'INTERNAL_ERROR', message: 'fail', request_id: null }),
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res))
    await expect(syncVault()).rejects.toBeInstanceOf(ApiError)
  })
})
