import { useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Citation } from '../lib/types'
import { usePreviewStore, scheduleClose, cancelClose } from '../stores/previewStore'

interface Props { citation: Citation }

const HOVER_OPEN_MS = 2000

export function ReferenceChip({ citation }: Props) {
  const navigate = useNavigate()
  const openTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (openTimer.current) window.clearTimeout(openTimer.current)
    }
  }, [])

  const label = citation.start === citation.end
    ? `${citation.slug}:${citation.start}`
    : `${citation.slug}:${citation.start}-${citation.end}`

  function clearOpenTimer() {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current)
      openTimer.current = null
    }
  }

  function onMouseEnter() {
    cancelClose()
    clearOpenTimer()
    openTimer.current = window.setTimeout(() => {
      usePreviewStore.getState().openPreview(citation)
      openTimer.current = null
    }, HOVER_OPEN_MS)
  }

  function onMouseLeave() {
    clearOpenTimer()
    // If a preview is already open (for this chip or any other), schedule
    // close — panel's mouseenter will cancel it if the mouse reaches the panel.
    if (usePreviewStore.getState().active) {
      scheduleClose()
    }
  }

  function onDoubleClick() {
    clearOpenTimer()
    cancelClose()
    usePreviewStore.getState().closePreview()
    const range = citation.start === citation.end
      ? `${citation.start}`
      : `${citation.start}-${citation.end}`
    navigate(`/wiki/${citation.slug}?lines=${range}`)
  }

  return (
    <button
      type="button"
      aria-label={label}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onDoubleClick={onDoubleClick}
      data-reference-chip
      className="inline-block bg-parchment border border-border-warm rounded text-stone-gray text-xs px-1.5 py-0.5 hover:bg-warm-sand hover:text-near-black transition-colors cursor-pointer"
    >
      {label}
    </button>
  )
}
