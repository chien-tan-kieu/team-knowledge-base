import { useState, useEffect } from 'react'
import { ApiError, getWikiPages, getWikiPage } from '../lib/api'
import type { WikiPage } from '../lib/types'

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e
  return new ApiError({ code: 'INTERNAL_ERROR', message: 'Request failed.', requestId: null, status: 0 })
}

export function useWikiPages() {
  const [pages, setPages] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)

  useEffect(() => {
    getWikiPages()
      .then(p => {
        setPages(p)
        setError(null)
      })
      .catch(e => setError(toApiError(e)))
      .finally(() => setLoading(false))
  }, [])

  return { pages, loading, error }
}

export function useWikiPage(slug: string | null) {
  const [page, setPage] = useState<WikiPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  useEffect(() => {
    if (!slug) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting loading/error on slug change is the canonical pattern.
    setLoading(true)
    setError(null)
    getWikiPage(slug)
      .then(setPage)
      .catch(e => setError(toApiError(e)))
      .finally(() => setLoading(false))
  }, [slug])

  return { page, loading, error }
}
