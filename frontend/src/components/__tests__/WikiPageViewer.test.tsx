import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { WikiPageViewer } from '../WikiPageViewer'

describe('WikiPageViewer', () => {
  it('attaches data-source-line-* to rendered blocks', () => {
    const md = '# Title\n\nFirst paragraph.\n\nSecond paragraph.'
    const { container } = render(<WikiPageViewer content={md} />)
    const h1 = container.querySelector('h1')
    expect(h1?.getAttribute('data-source-line-start')).toBe('1')
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0].getAttribute('data-source-line-start')).toBe('3')
    expect(paragraphs[1].getAttribute('data-source-line-start')).toBe('5')
  })
})
