import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReferenceChip } from '../ReferenceChip'
import { usePreviewStore } from '../../stores/previewStore'

function renderChip(citation = { slug: 'deploy-process', start: 15, end: 22 }) {
  return render(
    <MemoryRouter>
      <ReferenceChip citation={citation} />
    </MemoryRouter>
  )
}

beforeEach(() => {
  usePreviewStore.setState({ active: null })
  vi.useFakeTimers()
})

describe('ReferenceChip', () => {
  it('renders range label', () => {
    renderChip()
    expect(screen.getByRole('button', { name: /deploy-process:15-22/ })).toBeInTheDocument()
  })

  it('renders single-line label when start === end', () => {
    renderChip({ slug: 'ci-cd', start: 30, end: 30 })
    expect(screen.getByRole('button', { name: /ci-cd:30/ })).toBeInTheDocument()
  })

  it('opens preview after 2s of hover', () => {
    renderChip()
    const chip = screen.getByRole('button')
    fireEvent.mouseEnter(chip)
    expect(usePreviewStore.getState().active).toBeNull()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(usePreviewStore.getState().active).toEqual({
      slug: 'deploy-process', start: 15, end: 22,
    })
  })

  it('cancels the open timer on mouseleave before 2s', () => {
    renderChip()
    const chip = screen.getByRole('button')
    fireEvent.mouseEnter(chip)
    act(() => { vi.advanceTimersByTime(1500) })
    fireEvent.mouseLeave(chip)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(usePreviewStore.getState().active).toBeNull()
  })

  it('double-click closes preview and does not trigger hover timer', () => {
    vi.useRealTimers()
    renderChip()
    const chip = screen.getByRole('button')
    fireEvent.doubleClick(chip)
    expect(usePreviewStore.getState().active).toBeNull()
  })
})
