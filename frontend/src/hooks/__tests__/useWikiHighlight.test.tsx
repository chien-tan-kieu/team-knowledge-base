import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRef, useEffect } from 'react'
import { useWikiHighlight } from '../useWikiHighlight'

function TestHost({ lines }: { lines: string | null }) {
  const ref = useRef<HTMLDivElement>(null)
  useWikiHighlight(ref, lines)
  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = `
      <h1 data-source-line-start="1" data-source-line-end="1">Title</h1>
      <p data-source-line-start="3" data-source-line-end="3">A</p>
      <p data-source-line-start="5" data-source-line-end="7">B</p>
      <p data-source-line-start="9" data-source-line-end="9">C</p>
    `
  }, [])
  return <div ref={ref} />
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.useFakeTimers()
})

describe('useWikiHighlight', () => {
  it('adds .kb-highlight to overlapping blocks', () => {
    const { container, rerender } = render(<TestHost lines={null} />)
    rerender(<TestHost lines="5-6" />)
    const highlighted = container.querySelectorAll('.kb-highlight')
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0].textContent).toBe('B')
  })

  it('removes the class after 5s', () => {
    const { container, rerender } = render(<TestHost lines={null} />)
    rerender(<TestHost lines="5-6" />)
    expect(container.querySelectorAll('.kb-highlight')).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(5100) })
    act(() => { vi.advanceTimersByTime(700) })
    expect(container.querySelectorAll('.kb-highlight')).toHaveLength(0)
  })

  it('ignores malformed param', () => {
    const { container, rerender } = render(<TestHost lines={null} />)
    rerender(<TestHost lines="garbage" />)
    expect(container.querySelectorAll('.kb-highlight')).toHaveLength(0)
  })

  it('handles out-of-bounds range (no match, no crash)', () => {
    const { container, rerender } = render(<TestHost lines={null} />)
    rerender(<TestHost lines="999-1000" />)
    expect(container.querySelectorAll('.kb-highlight')).toHaveLength(0)
  })
})
