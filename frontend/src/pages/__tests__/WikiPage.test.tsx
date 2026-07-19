import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { WikiPage } from '../WikiPage'
import type { WikiPage as WikiPageType } from '../../lib/types'

const mockUseWikiPage = vi.fn()

vi.mock('../../hooks/useWiki', () => ({
  useWikiPage: (slug: string | null) => mockUseWikiPage(slug),
}))

function renderAt(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/wiki/${slug}`]}>
      <Routes>
        <Route path="/wiki/:slug" element={<WikiPage />} />
      </Routes>
    </MemoryRouter>
  )
}

const page: WikiPageType = {
  slug: 'bmad',
  content: '---\nslug: bmad\ntitle: BMad\nupdated: 2026-07-14\n---\n# BMad\n\nBody text.',
  frontmatter: { slug: 'bmad', title: 'BMad', updated: '2026-07-14' },
  body: '# BMad\n\nBody text.',
}

describe('WikiPage', () => {
  it('renders the page body without frontmatter', () => {
    mockUseWikiPage.mockReturnValue({ page, loading: false, error: null })
    renderAt('bmad')
    expect(screen.getByText('Body text.')).toBeInTheDocument()
    expect(screen.queryByText(/slug: bmad/)).not.toBeInTheDocument()
    expect(screen.queryByText(/updated: 2026-07-14/)).not.toBeInTheDocument()
  })

  it('uses the frontmatter title in the page header instead of the slugified slug', () => {
    mockUseWikiPage.mockReturnValue({
      page: { ...page, frontmatter: { ...page.frontmatter, title: 'BMad Process' } },
      loading: false,
      error: null,
    })
    const { container } = renderAt('bmad')
    const headerTitle = container.querySelector('header h1')
    expect(headerTitle?.textContent).toBe('BMad Process')
  })

  it('displays the frontmatter updated date', () => {
    mockUseWikiPage.mockReturnValue({ page, loading: false, error: null })
    renderAt('bmad')
    expect(screen.getByText(/Jul 14, 2026/)).toBeInTheDocument()
  })
})
