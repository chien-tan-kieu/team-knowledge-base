import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useIngest } from '../useIngest'
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

describe('useIngest', () => {
  it('exposes ApiError when upload fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ code: 'VALIDATION_ERROR', message: 'bad file', request_id: null }, false, 422),
    ))
    const { result } = renderHook(() => useIngest())

    await act(async () => {
      await result.current.upload(new File(['x'], 'x.md'))
    })

    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError))
    expect(result.current.error?.code).toBe('VALIDATION_ERROR')
    expect(result.current.job).toBeNull()
  })
})
