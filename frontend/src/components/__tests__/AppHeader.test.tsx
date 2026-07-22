import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppHeader } from '../AppHeader'

function renderHeader(onSearchOpen: () => void) {
  return render(
    <MemoryRouter>
      <AppHeader
        onMobileMenuOpen={() => {}}
        sidebarCollapsed={false}
        onSidebarToggle={() => {}}
        onSearchOpen={onSearchOpen}
      />
    </MemoryRouter>,
  )
}

describe('<AppHeader /> search trigger', () => {
  it('renders exactly one Search button and opens search on click', async () => {
    const onSearchOpen = vi.fn()
    renderHeader(onSearchOpen)

    const searchButtons = screen.getAllByRole('button', { name: 'Search' })
    expect(searchButtons).toHaveLength(1)

    await userEvent.click(searchButtons[0])
    expect(onSearchOpen).toHaveBeenCalledTimes(1)
  })
})
