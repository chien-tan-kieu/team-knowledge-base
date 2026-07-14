import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useWikiPagesStore } from '../wikiStore'
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
  vi.restoreAllMocks()
  useWikiPagesStore.setState({ pages: [], loading: true, error: null })
})

describe('wikiStore.fetchPages', () => {
  it('loads pages on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ pages: ['a', 'b'] })))
    await useWikiPagesStore.getState().fetchPages()
    expect(useWikiPagesStore.getState().pages).toEqual(['a', 'b'])
    expect(useWikiPagesStore.getState().loading).toBe(false)
    expect(useWikiPagesStore.getState().error).toBeNull()
  })

  it('sets ApiError on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ code: 'INTERNAL_ERROR', message: 'boom', request_id: null }, false, 500)
    ))
    await useWikiPagesStore.getState().fetchPages()
    expect(useWikiPagesStore.getState().error).toBeInstanceOf(ApiError)
    expect(useWikiPagesStore.getState().loading).toBe(false)
  })

  it('replaces the page list on repeated calls, reflecting newly ingested pages', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes({ pages: [] }))
      .mockResolvedValueOnce(jsonRes({ pages: ['new-page'] }))
    vi.stubGlobal('fetch', fetchMock)

    await useWikiPagesStore.getState().fetchPages()
    expect(useWikiPagesStore.getState().pages).toEqual([])

    await useWikiPagesStore.getState().fetchPages()
    expect(useWikiPagesStore.getState().pages).toEqual(['new-page'])
  })
})
