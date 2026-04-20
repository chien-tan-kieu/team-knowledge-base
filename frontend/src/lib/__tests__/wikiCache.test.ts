import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getWikiContent, _resetWikiCache } from '../wikiCache'

beforeEach(() => {
  _resetWikiCache()
  vi.restoreAllMocks()
})

describe('wikiCache', () => {
  it('fetches and caches content by slug', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      { ok: true, json: async () => ({ slug: 'x', content: 'hello' }) }
    )
    vi.stubGlobal('fetch', fetchMock)

    const a = await getWikiContent('x')
    const b = await getWikiContent('x')

    expect(a).toBe('hello')
    expect(b).toBe('hello')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('dedups concurrent fetches for the same slug', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      new Promise(r => setTimeout(() => r({ ok: true, json: async () => ({ slug: 'x', content: 'c' }) }), 20))
    )
    vi.stubGlobal('fetch', fetchMock)

    const [a, b] = await Promise.all([getWikiContent('x'), getWikiContent('x')])
    expect(a).toBe('c')
    expect(b).toBe('c')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('allows retry after a failed fetch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ slug: 'x', content: 'recovered' }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getWikiContent('x')).rejects.toBeDefined()
    await expect(getWikiContent('x')).resolves.toBe('recovered')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
