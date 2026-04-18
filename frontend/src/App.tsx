import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { WikiDrawer } from './components/WikiDrawer'
import { SessionGate } from './components/SessionGate'
import { ChatPage } from './pages/ChatPage'
import { WikiPage } from './pages/WikiPage'
import { IngestPage } from './pages/IngestPage'

export function App() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [wikiDrawerOpen, setWikiDrawerOpen] = useState(false)

  function handleNavigate() {
    setDrawerOpen(false)
    setWikiDrawerOpen(false)
  }

  function handleWikiToggle() {
    setDrawerOpen(false)
    setWikiDrawerOpen(o => !o)
  }

  return (
    <SessionGate>
      <div className="flex flex-col h-screen bg-parchment">
        <header className="h-13 flex items-center gap-3 px-4 sm:px-6 border-b border-border-cream bg-parchment flex-shrink-0 pt-safe">
          <button
            type="button"
            aria-label="Open navigation"
            className="md:hidden -ml-2 p-2 rounded-md text-olive-gray hover:bg-border-cream active:bg-warm-sand"
            onClick={() => {
              setDrawerOpen(true)
              setWikiDrawerOpen(false)
            }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-serif text-base font-medium text-near-black">Knowledge Base</span>
        </header>

        <div className="flex flex-1 overflow-hidden relative">
          <button
            type="button"
            aria-label="Close navigation"
            tabIndex={drawerOpen ? 0 : -1}
            className={`md:hidden fixed inset-0 z-30 bg-near-black/30 transition-opacity duration-200 ease-out ${
              drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            onClick={() => setDrawerOpen(false)}
          />
          <Sidebar
            open={drawerOpen}
            onNavigate={handleNavigate}
            onWikiToggle={handleWikiToggle}
            wikiDrawerOpen={wikiDrawerOpen}
          />
          <WikiDrawer open={wikiDrawerOpen} onClose={() => setWikiDrawerOpen(false)} />
          <main className="flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<ChatPage />} />
              <Route path="/wiki" element={<WikiPage />} />
              <Route path="/wiki/:slug" element={<WikiPage />} />
              <Route path="/ingest" element={<IngestPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </SessionGate>
  )
}
