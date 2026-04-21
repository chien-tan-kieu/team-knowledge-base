import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '../relativeTime'

describe('formatRelativeTime', () => {
  const now = new Date('2026-04-21T12:00:00Z').getTime()

  it('returns "just now" for deltas under 60s', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('just now')
    expect(formatRelativeTime(now, now)).toBe('just now')
  })

  it('returns "Nm ago" between 1 and 59 minutes', () => {
    expect(formatRelativeTime(now - 60_000, now)).toBe('1m ago')
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(formatRelativeTime(now - 59 * 60_000, now)).toBe('59m ago')
  })

  it('returns "Nh ago" between 1 and 23 hours', () => {
    expect(formatRelativeTime(now - 60 * 60_000, now)).toBe('1h ago')
    expect(formatRelativeTime(now - 23 * 60 * 60_000, now)).toBe('23h ago')
  })

  it('returns "yesterday" between 24 and 47 hours', () => {
    expect(formatRelativeTime(now - 24 * 60 * 60_000, now)).toBe('yesterday')
    expect(formatRelativeTime(now - 47 * 60 * 60_000, now)).toBe('yesterday')
  })

  it('returns a localized date beyond 48h', () => {
    const ts = now - 5 * 24 * 60 * 60_000
    expect(formatRelativeTime(ts, now)).toBe(new Date(ts).toLocaleDateString())
  })
})
