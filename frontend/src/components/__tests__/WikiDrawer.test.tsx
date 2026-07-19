import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { WikiDrawer } from '../WikiDrawer'

vi.mock('../../hooks/useWiki', () => ({
  useWikiPages: () => ({
    pages: [
      { slug: 'old-page', title: null, topic: null },
      { slug: 'bmad', title: 'BMAD', topic: 'spec-tools' },
      { slug: 'speckit', title: 'SpecKit', topic: 'spec-tools' },
      { slug: 'fluency-illusion', title: 'Fluency Illusion', topic: 'cognition' },
    ],
    loading: false,
    error: null,
  }),
}))

function renderDrawer() {
  return render(
    <MemoryRouter>
      <WikiDrawer open onClose={() => {}} />
    </MemoryRouter>,
  )
}

describe('WikiDrawer topic grouping', () => {
  it('renders topic sections alphabetically with Uncategorized last', () => {
    renderDrawer()
    const headings = screen.getAllByTestId('topic-heading').map(el => el.textContent)
    expect(headings).toEqual(['Cognition', 'Spec Tools', 'Uncategorized'])
  })

  it('renders page links under their topic section', () => {
    renderDrawer()
    expect(screen.getByRole('link', { name: /bmad/i })).toHaveAttribute(
      'href',
      '/wiki/bmad',
    )
    expect(screen.getByRole('link', { name: /old-page/i })).toHaveAttribute(
      'href',
      '/wiki/old-page',
    )
  })

  it('drops empty topic sections when filtering', async () => {
    renderDrawer()
    await userEvent.type(screen.getByRole('searchbox'), 'bmad')
    const headings = screen.getAllByTestId('topic-heading').map(el => el.textContent)
    expect(headings).toEqual(['Spec Tools'])
  })
})
