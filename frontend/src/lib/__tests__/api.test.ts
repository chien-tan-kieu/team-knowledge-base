import { describe, it, expect, vi, beforeEach } from 'vitest'
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
    expect(fetch).toHaveBeenCalledWith('/api/wiki', undefined)
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
    expect(fetch).toHaveBeenCalledWith('/api/wiki/deploy-process', undefined)
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
