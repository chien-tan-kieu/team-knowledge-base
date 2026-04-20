import { useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useWikiPage } from '../hooks/useWiki'
import { WikiPageViewer } from '../components/WikiPageViewer'
import { ErrorBanner } from '../components/ErrorBanner'
import { useWikiHighlight } from '../hooks/useWikiHighlight'

function slugToTitle(slug: string) {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function EmptyState() {
  return (
    <div className="max-w-[52ch] py-16 animate-[riseIn_0.5s_var(--ease-out)]">
      <span className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-dim">
        <span
          aria-hidden
          className="inline-block w-4 border-t"
          style={{ borderColor: 'var(--color-fg-dim)' }}
        />
        Wiki
      </span>
      <h1
        className="font-serif text-[32px] leading-[1.15] tracking-[-0.02em] mt-2 mb-3 text-fg"
        style={{ fontVariationSettings: '"opsz" 48', fontWeight: 500 }}
      >
        A living knowledge base for your team.
      </h1>
      <p
        className="font-serif text-[17px] leading-[1.65] text-fg-muted"
        style={{ fontVariationSettings: '"opsz" 18' }}
      >
        Open a page from the left drawer to read, or head to
        <em className="italic">Add Document</em> to compile something new.
      </p>
    </div>
  )
}

export function WikiPage() {
  const { slug } = useParams<{ slug?: string }>()
  const [searchParams] = useSearchParams()
  const linesParam = searchParams.get('lines')
  const { page, loading, error } = useWikiPage(slug ?? null)
  const contentRef = useRef<HTMLDivElement>(null)

  useWikiHighlight(contentRef, page ? linesParam : null)

  return (
    <div className="h-full overflow-y-auto pb-safe">
      <div
        className="grid gap-8 px-6 md:px-10 lg:px-14 py-8"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 220px)' }}
      >
        <article className="min-w-0">
          {!slug && !error && <EmptyState />}

          {slug && (
            <header className="flex items-end justify-between gap-6 mb-6 pb-4 border-b border-line">
              <div>
                <span className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-dim">
                  <span
                    aria-hidden
                    className="inline-block w-4 border-t"
                    style={{ borderColor: 'var(--color-fg-dim)' }}
                  />
                  Wiki · <span className="font-mono normal-case tracking-tight">{slug}</span>
                </span>
                <h1
                  className="font-serif text-[28px] leading-[1.15] tracking-[-0.02em] mt-2 mb-0 text-fg"
                  style={{ fontVariationSettings: '"opsz" 48', fontWeight: 500 }}
                >
                  {slugToTitle(slug)}
                </h1>
              </div>
            </header>
          )}

          {loading && (
            <p className="text-fg-dim font-sans text-sm animate-pulse">Loading…</p>
          )}
          {error && <ErrorBanner error={error} />}
          {page && !error && (
            <div ref={contentRef}>
              <WikiPageViewer content={page.content} />
            </div>
          )}
        </article>

        {/* Margin rail — hidden below 1100px */}
        <aside
          className="hidden xl:flex sticky top-6 self-start flex-col gap-3 min-w-0"
          aria-label="Page rail"
        >
          {slug && (
            <div
              className="bg-surface rounded-xl px-4 py-3.5 flex flex-col gap-2"
              style={{ boxShadow: 'var(--shadow-ring)' }}
            >
              <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-fg-dim">
                On this page
              </span>
              <span className="text-[12.5px] text-fg-muted font-sans">
                Scroll the page to read; use your browser's find (⌘F) to jump.
              </span>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
