import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getWikiPages, getWikiPage, ingestFile, startChat, ApiError } from '../api'

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
