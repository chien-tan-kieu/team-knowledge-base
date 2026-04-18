import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewPanel } from '../PreviewPanel'
import { usePreviewStore } from '../../stores/previewStore'
import { _resetWikiCache } from '../../lib/wikiCache'

beforeEach(() => {
  usePreviewStore.setState({ active: null })
  _resetWikiCache()
  vi.restoreAllMocks()
})

describe('PreviewPanel', () => {
  it('renders nothing when no active citation', () => {
    const { container } = render(<PreviewPanel />)
    expect(container.textContent).toBe('')
  })

  it('renders line-numbered source with highlighted range when active', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        slug: 'x',
        content: 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10',
      }),
    }))

    render(<PreviewPanel />)
    act(() => {
      usePreviewStore.getState().openPreview({ slug: 'x', start: 4, end: 6 })
    })

    await waitFor(() => {
      expect(screen.getByText(/lines 4–6/)).toBeInTheDocument()
    })
    // ±3 context lines means lines 1..9 are visible.
    expect(screen.getByText(/line1/)).toBeInTheDocument()
    expect(screen.getByText(/line9/)).toBeInTheDocument()
    // line10 is outside the ±3 window.
    expect(screen.queryByText(/line10/)).toBeNull()
  })

  it('closes on Escape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ slug: 'x', content: 'a\nb\nc' }),
    }))

    render(<PreviewPanel />)
    act(() => {
      usePreviewStore.getState().openPreview({ slug: 'x', start: 1, end: 1 })
    })
    await waitFor(() => screen.getByText(/lines 1/))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(usePreviewStore.getState().active).toBeNull()
  })
})
