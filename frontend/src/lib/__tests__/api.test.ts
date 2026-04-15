import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getWikiPages, getWikiPage, ingestFile, startChat } from '../api'

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
    expect(fetch).toHaveBeenCalledWith('/api/wiki')
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
    expect(fetch).toHaveBeenCalledWith('/api/wiki/deploy-process')
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
  })
})
