import { useParams } from 'react-router-dom'
import { useWikiPage } from '../hooks/useWiki'
import { WikiPageViewer } from '../components/WikiPageViewer'
import { ErrorBanner } from '../components/ErrorBanner'

export function WikiPage() {
  const { slug } = useParams<{ slug?: string }>()
  const { page, loading: pageLoading, error: pageError } = useWikiPage(slug ?? null)

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 md:px-8 py-4 sm:py-6 pb-safe">
      {!slug && !pageError && (
        <p className="text-stone-gray font-sans text-sm">Open <em>Wiki</em> in the sidebar to pick a page.</p>
      )}
      {pageLoading && <p className="text-stone-gray font-sans text-sm">Loading…</p>}
      {pageError && <ErrorBanner error={pageError} />}
      {page && !pageError && <WikiPageViewer content={page.content} />}
    </div>
  )
}
