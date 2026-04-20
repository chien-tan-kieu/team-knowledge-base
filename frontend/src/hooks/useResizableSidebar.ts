import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Click-and-drag resize for the left sidebar, Claude Desktop–style.
 * - Writes --sidebar-w on <html> during drag
 * - Snaps to collapsed (icon-only) when dragged below SNAP_THRESHOLD
 * - Persists width + collapsed state in localStorage
 * - Double-click the handle toggles collapsed
 * - Arrow keys with Shift move by 16px; plain arrows by 4px
 */

const STORAGE_WIDTH = 'tkb-sidebar-w'
const STORAGE_COLLAPSED = 'tkb-sidebar-collapsed'

const MIN_W = 250
const MAX_W = 420
const DEFAULT_W = 260
const COLLAPSED_W = 64
const SNAP_THRESHOLD = 200

function readStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_W
  try {
    const raw = window.localStorage.getItem(STORAGE_WIDTH)
    const n = raw ? parseInt(raw, 10) : NaN
    if (!Number.isFinite(n)) return DEFAULT_W
    return Math.max(MIN_W, Math.min(MAX_W, n))
  } catch {
    return DEFAULT_W
  }
}

function readStoredCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_COLLAPSED) === '1'
  } catch {
    return false
  }
}

export function useResizableSidebar() {
  const [width, setWidth] = useState<number>(readStoredWidth)
  const [collapsed, setCollapsed] = useState<boolean>(readStoredCollapsed)
  const [dragging, setDragging] = useState(false)
  const [snapHint, setSnapHint] = useState(false)
  const startXRef = useRef(0)
  const startWRef = useRef(width)

  // Apply width + collapsed state to documentElement
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--sidebar-w', `${collapsed ? COLLAPSED_W : width}px`)
    if (collapsed) root.setAttribute('data-sidebar', 'collapsed')
    else root.removeAttribute('data-sidebar')
  }, [width, collapsed])

  // Persist on change
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_WIDTH, String(width))
    } catch { /* ignore */ }
  }, [width])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_COLLAPSED, collapsed ? '1' : '0')
    } catch { /* ignore */ }
  }, [collapsed])

  // Pointer drag
  useEffect(() => {
    if (!dragging) return

    function handleMove(e: PointerEvent) {
      const delta = e.clientX - startXRef.current
      const next = startWRef.current + delta
      if (next < SNAP_THRESHOLD) {
        setSnapHint(true)
        // Show visual clamp at MIN_W while hinting at collapse
        setWidth(MIN_W)
      } else {
        setSnapHint(false)
        setWidth(Math.max(MIN_W, Math.min(MAX_W, next)))
      }
    }

    function handleUp(e: PointerEvent) {
      const delta = e.clientX - startXRef.current
      const final = startWRef.current + delta
      setDragging(false)
      setSnapHint(false)
      document.body.classList.remove('is-dragging')
      if (final < SNAP_THRESHOLD) {
        setCollapsed(true)
      } else {
        setCollapsed(false)
        setWidth(Math.max(MIN_W, Math.min(MAX_W, final)))
      }
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [dragging])

  const onHandlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    startXRef.current = e.clientX
    startWRef.current = collapsed ? COLLAPSED_W : width
    setDragging(true)
    if (collapsed) setCollapsed(false)
    document.body.classList.add('is-dragging')
  }, [collapsed, width])

  const toggleCollapsed = useCallback(() => {
    setCollapsed(c => !c)
  }, [])

  const onHandleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleCollapsed()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      if (collapsed) return
      const step = e.shiftKey ? 16 : 4
      const sign = e.key === 'ArrowRight' ? 1 : -1
      setWidth(w => Math.max(MIN_W, Math.min(MAX_W, w + step * sign)))
    }
  }, [collapsed, toggleCollapsed])

  return {
    width,
    collapsed,
    dragging,
    snapHint,
    onHandlePointerDown,
    onHandleKeyDown,
    toggleCollapsed,
  }
}
