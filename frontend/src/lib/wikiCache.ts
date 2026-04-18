import { getWikiPage } from './api'

const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

export async function getWikiContent(slug: string): Promise<string> {
  const cached = cache.get(slug)
  if (cached !== undefined) return cached
  const pending = inflight.get(slug)
  if (pending) return pending
  const p = getWikiPage(slug)
    .then(page => {
      cache.set(slug, page.content)
      return page.content
    })
    .finally(() => {
      inflight.delete(slug)
    })
  inflight.set(slug, p)
  return p
}

// Test helper — not part of the public API.
export function _resetWikiCache(): void {
  cache.clear()
  inflight.clear()
}
