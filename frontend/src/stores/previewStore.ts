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

// Shared close-timer handle — both ReferenceChip and PreviewPanel use this
// so the chip+panel form one hover region.
const HOVER_CLOSE_MS = 200
const closeTimerRef: { current: number | null } = { current: null }

export function scheduleClose(): void {
  closeTimerRef.current && window.clearTimeout(closeTimerRef.current)
  closeTimerRef.current = window.setTimeout(() => {
    usePreviewStore.getState().closePreview()
    closeTimerRef.current = null
  }, HOVER_CLOSE_MS)
}

export function cancelClose(): void {
  closeTimerRef.current && window.clearTimeout(closeTimerRef.current)
  closeTimerRef.current = null
}
