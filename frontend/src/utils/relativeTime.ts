const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - ts)
  if (delta < MINUTE) return 'just now'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`
  if (delta < 2 * DAY) return 'yesterday'
  return new Date(ts).toLocaleDateString()
}
