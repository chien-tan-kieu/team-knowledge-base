import { useEffect, useRef, useState } from 'react'
import { usePreviewStore } from '../stores/previewStore'
import { getWikiContent } from '../lib/wikiCache'

const CONTEXT_LINES = 3
const HOVER_CLOSE_MS = 200

export function PreviewPanel() {
  const active = usePreviewStore(s => s.active)
  const close = usePreviewStore(s => s.closePreview)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      setContent(null)
      setError(null)
      return
    }
    let cancelled = false
    setContent(null)
    setError(null)
    getWikiContent(active.slug)
      .then(c => { if (!cancelled) setContent(c) })
      .catch(() => { if (!cancelled) setError('Unable to load preview') })
    return () => { cancelled = true }
  }, [active])

  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Element
      if (!panelRef.current) return
      if (panelRef.current.contains(target)) return
      if (target.closest('[data-reference-chip]')) return
      close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClickOutside)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [active, close])

  function onPanelEnter() {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
  }
  function onPanelLeave() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => close(), HOVER_CLOSE_MS)
  }

  if (!active) return null

  const rangeLabel = active.start === active.end ? `${active.start}` : `${active.start}–${active.end}`
  const allLines = (content ?? '').split('\n')
  const windowStart = Math.max(1, active.start - CONTEXT_LINES)
  const windowEnd = Math.min(allLines.length, active.end + CONTEXT_LINES)
  const rendered: Array<{ n: number; text: string; inRange: boolean }> = []
  for (let i = windowStart; i <= windowEnd; i++) {
    rendered.push({ n: i, text: allLines[i - 1] ?? '', inRange: i >= active.start && i <= active.end })
  }

  return (
    <div
      ref={panelRef}
      onMouseEnter={onPanelEnter}
      onMouseLeave={onPanelLeave}
      role="dialog"
      aria-label="Citation preview"
      className="absolute right-0 top-0 bottom-0 w-full sm:w-[320px] bg-ivory border-l border-border-warm shadow-lg z-10 flex flex-col"
      style={{ transition: 'transform 180ms ease, opacity 180ms ease' }}
    >
      <div className="px-3 py-2 border-b border-border-cream flex items-center justify-between">
        <div className="text-xs font-sans text-stone-gray uppercase tracking-wide">
          {active.slug} · lines {rangeLabel}
        </div>
        <button
          onClick={close}
          aria-label="Close preview"
          className="text-stone-gray hover:text-near-black text-sm px-2"
        >×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-xs font-mono leading-relaxed">
        {error && <div className="text-red-700">{error}</div>}
        {!error && content === null && <div className="text-stone-gray">Loading…</div>}
        {!error && content !== null && rendered.length === 0 && (
          <div className="text-stone-gray">Range extends beyond page.</div>
        )}
        {!error && content !== null && rendered.map(r => (
          <div
            key={r.n}
            className={r.inRange ? 'bg-[#fff7d9] -mx-3 px-3' : ''}
          >
            <span className="text-stone-gray mr-2 select-none">{r.n}</span>
            <span className="text-near-black whitespace-pre-wrap break-words">{r.text}</span>
          </div>
        ))}
      </div>
      <div className="px-3 py-1.5 border-t border-border-cream text-[10px] font-sans text-stone-gray">
        Double-click link to open page
      </div>
    </div>
  )
}
