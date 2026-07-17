import type { WikiPageMeta } from './types'

export interface TopicGroup {
  topic: string | null
  label: string
  pages: WikiPageMeta[]
}

export function humanizeTopic(topic: string): string {
  return topic
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function groupByTopic(pages: WikiPageMeta[]): TopicGroup[] {
  const byTopic = new Map<string | null, WikiPageMeta[]>()
  for (const page of pages) {
    const list = byTopic.get(page.topic) ?? []
    list.push(page)
    byTopic.set(page.topic, list)
  }

  const bySlug = (a: WikiPageMeta, b: WikiPageMeta) => a.slug.localeCompare(b.slug)
  const topics = [...byTopic.keys()]
    .filter((t): t is string => t !== null)
    .sort()

  const groups: TopicGroup[] = topics.map(topic => ({
    topic,
    label: humanizeTopic(topic),
    pages: [...byTopic.get(topic)!].sort(bySlug),
  }))

  const uncategorized = byTopic.get(null)
  if (uncategorized) {
    groups.push({
      topic: null,
      label: 'Uncategorized',
      pages: [...uncategorized].sort(bySlug),
    })
  }
  return groups
}
