import { useParams, Link } from 'react-router-dom'
import { useWikiPages, useWikiPage } from '../hooks/useWiki'
import { WikiPageViewer } from '../components/WikiPageViewer'

export function WikiPage() {
  const { slug } = useParams<{ slug?: string }>()
  const { pages, loading: listLoading } = useWikiPages()
  const { page, loading: pageLoading } = useWikiPage(slug ?? null)

  return (
    <div className="flex h-full">
      {/* Page list */}
      <div className="w-48 border-r border-border-cream py-4 overflow-y-auto flex-shrink-0">
        <p className="px-3 pb-2 text-xs font-medium text-stone-gray uppercase tracking-widest font-sans">
          All Pages
        </p>
        {listLoading && <p className="px-3 text-xs text-stone-gray font-sans">Loading…</p>}
        {pages.map(s => (
          <Link
            key={s}
            to={`/wiki/${s}`}
            className={`block px-3 py-1.5 text-sm font-sans truncate ${
              s === slug
                ? 'bg-warm-sand text-near-black font-medium'
                : 'text-olive-gray hover:bg-border-cream'
            }`}
          >
            {s}
          </Link>
        ))}
        {!listLoading && pages.length === 0 && (
          <p className="px-3 text-xs text-stone-gray font-sans">No pages yet.</p>
        )}
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {!slug && (
          <p className="text-stone-gray font-sans text-sm">Select a page from the list.</p>
        )}
        {pageLoading && <p className="text-stone-gray font-sans text-sm">Loading…</p>}
        {page && <WikiPageViewer content={page.content} />}
      </div>
    </div>
  )
}
