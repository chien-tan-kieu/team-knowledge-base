import { describe, it, expect } from 'vitest'
import { groupByTopic, humanizeTopic } from '../topics'
import type { WikiPageMeta } from '../types'

const page = (slug: string, topic: string | null): WikiPageMeta => ({
  slug,
  title: null,
  topic,
})

describe('humanizeTopic', () => {
  it('title-cases hyphenated topic slugs', () => {
    expect(humanizeTopic('spec-tools')).toBe('Spec Tools')
    expect(humanizeTopic('cognition')).toBe('Cognition')
  })
})

describe('groupByTopic', () => {
  it('groups pages under alphabetical topics with Uncategorized last', () => {
    const groups = groupByTopic([
      page('old-page', null),
      page('speckit', 'spec-tools'),
      page('bmad', 'spec-tools'),
      page('fluency-illusion', 'cognition'),
    ])
    expect(groups.map(g => g.label)).toEqual(['Cognition', 'Spec Tools', 'Uncategorized'])
    expect(groups[1].pages.map(p => p.slug)).toEqual(['bmad', 'speckit'])
    expect(groups[2].topic).toBeNull()
    expect(groups[2].pages.map(p => p.slug)).toEqual(['old-page'])
  })

  it('omits Uncategorized when every page has a topic', () => {
    const groups = groupByTopic([page('bmad', 'spec-tools')])
    expect(groups.map(g => g.label)).toEqual(['Spec Tools'])
  })

  it('returns an empty array for no pages', () => {
    expect(groupByTopic([])).toEqual([])
  })
})
