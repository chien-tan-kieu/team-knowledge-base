import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { WikiPageViewer } from '../WikiPageViewer'

function renderWithRouter(content: string) {
  return render(
    <MemoryRouter>
      <WikiPageViewer content={content} />
    </MemoryRouter>
  )
}

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

  it('renders a GFM pipe table', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |\n'
    const { container } = render(<WikiPageViewer content={md} />)
    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    const cells = container.querySelectorAll('td')
    const texts = Array.from(cells).map((c) => c.textContent)
    expect(texts).toEqual(['1', '2'])
  })

  it('resolves a [[slug]] wikilink to a real wiki page link', () => {
    const { container } = renderWithRouter('See also [[combined-development-workflow]] for context.')
    const link = container.querySelector('a')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toBe('/wiki/combined-development-workflow')
    expect(link?.textContent).toBe('Combined Development Workflow')
  })

  it('resolves multiple wikilinks in a "See also" list', () => {
    const md = '## See also\n\n- [[speckit]]\n- [[bmad]]\n'
    const { container } = renderWithRouter(md)
    const links = Array.from(container.querySelectorAll('a'))
    expect(links.map(a => a.getAttribute('href'))).toEqual(['/wiki/speckit', '/wiki/bmad'])
    expect(links.map(a => a.textContent)).toEqual(['Speckit', 'Bmad'])
  })

  it('leaves wikilink-like text inside a fenced code block untouched', () => {
    const md = '```\n[[not-a-link]]\n```'
    const { container } = renderWithRouter(md)
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('code')?.textContent).toContain('[[not-a-link]]')
  })
})
