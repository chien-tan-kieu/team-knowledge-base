import { useParams, Link } from 'react-router-dom'
import { useWikiPages, useWikiPage } from '../hooks/useWiki'
import { WikiPageViewer } from '../components/WikiPageViewer'
import { ErrorBanner } from '../components/ErrorBanner'

export function WikiPage() {
  const { slug } = useParams<{ slug?: string }>()
  const { pages, loading: listLoading, error: listError } = useWikiPages()
  const { page, loading: pageLoading, error: pageError } = useWikiPage(slug ?? null)

  return (
    <div className="flex flex-col md:flex-row h-full overflow-y-auto md:overflow-hidden">
      <div className="flex-shrink-0 md:w-48 border-b md:border-b-0 md:border-r border-border-cream py-3 md:py-4 md:overflow-y-auto">
        <p className="px-4 sm:px-3 pb-2 text-xs font-medium text-stone-gray uppercase tracking-widest font-sans">
          All Pages
        </p>
        {listLoading && <p className="px-4 sm:px-3 text-xs text-stone-gray font-sans">Loading…</p>}
        {listError && (
          <div className="px-4 sm:px-3">
            <ErrorBanner error={listError} />
          </div>
        )}
        {pages.map(s => (
          <Link
            key={s}
            to={`/wiki/${s}`}
            className={`block px-4 sm:px-3 py-2.5 md:py-1.5 text-sm font-sans truncate ${
              s === slug
                ? 'bg-warm-sand text-near-black font-medium'
                : 'text-olive-gray hover:bg-border-cream'
            }`}
          >
            {s}
          </Link>
        ))}
        {!listLoading && !listError && pages.length === 0 && (
          <p className="px-4 sm:px-3 text-xs text-stone-gray font-sans">No pages yet.</p>
        )}
      </div>

      <div className="flex-1 md:overflow-y-auto px-4 sm:px-6 md:px-8 py-4 sm:py-6 pb-safe">
        {!slug && !pageError && (
          <p className="text-stone-gray font-sans text-sm">Select a page from the list.</p>
        )}
        {pageLoading && <p className="text-stone-gray font-sans text-sm">Loading…</p>}
        {pageError && <ErrorBanner error={pageError} />}
        {page && !pageError && <WikiPageViewer content={page.content} />}
      </div>
    </div>
  )
}
