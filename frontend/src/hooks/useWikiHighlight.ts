import { useEffect, type RefObject } from 'react'

const HIGHLIGHT_DURATION_MS = 5000
const FADE_MS = 600
const LINES_RE = /^(\d+)(?:-(\d+))?$/

export function useWikiHighlight(containerRef: RefObject<HTMLElement | null>, linesParam: string | null) {
  useEffect(() => {
    if (!linesParam) return
    const container = containerRef.current
    if (!container) return

    const match = LINES_RE.exec(linesParam)
    if (!match) return
    const start = parseInt(match[1], 10)
    const end = match[2] ? parseInt(match[2], 10) : start

    const blocks = Array.from(
      container.querySelectorAll<HTMLElement>('[data-source-line-start]')
    )
    const hits = blocks.filter(el => {
      const s = parseInt(el.getAttribute('data-source-line-start') ?? '0', 10)
      const e = parseInt(el.getAttribute('data-source-line-end') ?? `${s}`, 10)
      return s <= end && e >= start
    })

    if (hits.length === 0) {
      container.scrollTo?.({ top: 0, behavior: 'smooth' })
      return
    }

    hits[0].scrollIntoView({ behavior: 'smooth', block: 'start' })
    hits.forEach(el => el.classList.add('kb-highlight'))

    const fadeTimer = window.setTimeout(() => {
      hits.forEach(el => el.classList.add('kb-highlight-fading'))
    }, HIGHLIGHT_DURATION_MS - FADE_MS)
    const removeTimer = window.setTimeout(() => {
      hits.forEach(el => {
        el.classList.remove('kb-highlight')
        el.classList.remove('kb-highlight-fading')
      })
    }, HIGHLIGHT_DURATION_MS)

    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(removeTimer)
      hits.forEach(el => {
        el.classList.remove('kb-highlight')
        el.classList.remove('kb-highlight-fading')
      })
    }
  }, [containerRef, linesParam])
}
