import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../App'

// Session gate resolves immediately so the app shell renders.
vi.mock('../components/SessionGate', () => ({
  SessionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
// Keep sub-pages/hooks out of this shell-level test.
vi.mock('../hooks/useWiki', () => ({
  useWikiPages: () => ({ pages: [], loading: false, error: null }),
}))

// ChatPage (rendered at "/") scrolls to bottom on mount; jsdom has no scrollIntoView.
Element.prototype.scrollIntoView = vi.fn()

function renderApp() {
  return render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  )
}

describe('App ⌘K search', () => {
  it('opens the search overlay on Cmd/Ctrl+K', async () => {
    renderApp()
    expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    expect(await screen.findByRole('dialog', { name: 'Search' })).toBeInTheDocument()
  })

  it('opens the search overlay when the header search button is clicked', async () => {
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByRole('dialog', { name: 'Search' })).toBeInTheDocument()
  })
})
