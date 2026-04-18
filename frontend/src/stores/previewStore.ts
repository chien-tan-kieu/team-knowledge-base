import { create } from 'zustand'
import type { Citation } from '../lib/types'

interface PreviewState {
  active: Citation | null
  openPreview: (c: Citation) => void
  closePreview: () => void
}

export const usePreviewStore = create<PreviewState>(set => ({
  active: null,
  openPreview: (c) => set({ active: c }),
  closePreview: () => set({ active: null }),
}))
