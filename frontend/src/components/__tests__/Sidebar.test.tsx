import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '../Sidebar'

vi.mock('../../hooks/useWiki', () => ({
  useWikiPages: () => ({ pages: ['page-one', 'page-two'], loading: false, error: null }),
}))

const fakeResize = {
  collapsed: false,
  width: 260,
  dragging: false,
  snapHint: false,
  toggleCollapsed: vi.fn(),
  onHandlePointerDown: vi.fn(),
  onHandleKeyDown: vi.fn(),
}

function renderSidebar(props: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const defaults = {
    open: true,
    onNavigate: vi.fn(),
    onWikiToggle: vi.fn(),
    wikiDrawerOpen: false,
    resize: fakeResize,
  }
  return render(
    <MemoryRouter>
      <Sidebar {...defaults} {...props} />
    </MemoryRouter>,
  )
}

describe('Sidebar — Wiki button on mobile', () => {
  // open=true means the sidebar is in mobile drawer mode

  it('does NOT call onWikiToggle when Wiki is clicked', async () => {
    const onWikiToggle = vi.fn()
    renderSidebar({ onWikiToggle })
    await userEvent.click(screen.getByRole('button', { name: /wiki/i }))
    expect(onWikiToggle).not.toHaveBeenCalled()
  })

  it('sets aria-expanded to true when Wiki is clicked', async () => {
    renderSidebar()
    const btn = screen.getByRole('button', { name: /wiki/i })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })

  it('calls onNavigate when a wiki page link is clicked', async () => {
    const onNavigate = vi.fn()
    renderSidebar({ onNavigate })
    await userEvent.click(screen.getByRole('button', { name: /wiki/i }))
    await userEvent.click(screen.getByRole('link', { name: /page-one/i }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })
})

describe('Sidebar — Wiki button on desktop', () => {
  // open=false means the sidebar is always-visible (desktop mode)

  it('calls onWikiToggle when Wiki is clicked', async () => {
    const onWikiToggle = vi.fn()
    renderSidebar({ open: false, onWikiToggle })
    await userEvent.click(screen.getByRole('button', { name: /wiki/i }))
    expect(onWikiToggle).toHaveBeenCalledTimes(1)
  })

  it('does NOT set aria-expanded when Wiki is clicked (wikiDrawerOpen stays false)', async () => {
    renderSidebar({ open: false })
    const btn = screen.getByRole('button', { name: /wiki/i })
    await userEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'false')
  })
})
