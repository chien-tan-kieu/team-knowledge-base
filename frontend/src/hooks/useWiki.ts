import { useState, useEffect } from 'react'
import { ApiError, coerceApiError, getWikiPage } from '../lib/api'
import type { WikiPage } from '../lib/types'
import { useWikiPagesStore } from '../stores/wikiStore'

export function useWikiPages() {
  const pages = useWikiPagesStore(s => s.pages)
  const loading = useWikiPagesStore(s => s.loading)
  const error = useWikiPagesStore(s => s.error)
  const fetchPages = useWikiPagesStore(s => s.fetchPages)

  useEffect(() => {
    fetchPages()
  }, [fetchPages])

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
      .catch(e => setError(coerceApiError(e)))
      .finally(() => setLoading(false))
  }, [slug])

  return { page, loading, error }
}
