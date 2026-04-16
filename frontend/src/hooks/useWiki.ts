import { useState, useEffect } from 'react'
import { getWikiPages, getWikiPage } from '../lib/api'
import type { WikiPage } from '../lib/types'

export function useWikiPages() {
  const [pages, setPages] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getWikiPages()
      .then(setPages)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return { pages, loading, error }
}

export function useWikiPage(slug: string | null) {
  const [page, setPage] = useState<WikiPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    setError(null)
    getWikiPage(slug)
      .then(setPage)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [slug])

  return { page, loading, error }
}
