import { create } from 'zustand'
import { ApiError, coerceApiError, getWikiPages } from '../lib/api'
import type { WikiPageMeta } from '../lib/types'

interface WikiPagesState {
  pages: WikiPageMeta[]
  loading: boolean
  error: ApiError | null
  fetchPages: () => Promise<void>
}

export const useWikiPagesStore = create<WikiPagesState>(set => ({
  pages: [],
  loading: true,
  error: null,
  fetchPages: async () => {
    set({ loading: true })
    try {
      const pages = await getWikiPages()
      set({ pages, loading: false, error: null })
    } catch (e: unknown) {
      set({ error: coerceApiError(e), loading: false })
    }
  },
}))
