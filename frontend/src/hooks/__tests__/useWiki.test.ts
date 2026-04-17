import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useWikiPages, useWikiPage } from '../useWiki'
import { ApiError } from '../../lib/api'

beforeEach(() => vi.restoreAllMocks())

function jsonRes(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response
}

describe('useWikiPages', () => {
  it('loads pages on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ pages: ['a', 'b'] })))
    const { result } = renderHook(() => useWikiPages())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.pages).toEqual(['a', 'b'])
    expect(result.current.error).toBeNull()
  })

  it('exposes ApiError on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ code: 'INTERNAL_ERROR', message: 'boom', request_id: '01H' }, false, 500),
    ))
    const { result } = renderHook(() => useWikiPages())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.code).toBe('INTERNAL_ERROR')
  })
})

describe('useWikiPage', () => {
  it('returns page on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ slug: 'a', content: '# A' })))
    const { result } = renderHook(() => useWikiPage('a'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.page?.slug).toBe('a')
  })
})
