import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { WikiDrawer } from './components/WikiDrawer'
import { SessionGate } from './components/SessionGate'
import { AppHeader } from './components/AppHeader'
import { ChatPage } from './pages/ChatPage'
import { WikiPage } from './pages/WikiPage'
import { IngestPage } from './pages/IngestPage'
import { useResizableSidebar } from './hooks/useResizableSidebar'

export function App() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [wikiDrawerOpen, setWikiDrawerOpen] = useState(false)

  const resize = useResizableSidebar()

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
      <div className="relative z-[2] h-dvh flex flex-col">
        <AppHeader
          onMobileMenuOpen={() => {
            setDrawerOpen(true)
            setWikiDrawerOpen(false)
          }}
          sidebarCollapsed={resize.collapsed}
          onSidebarToggle={resize.toggleCollapsed}
        />

        <div className="flex-1 min-h-0 flex relative">
          {/* Mobile backdrop */}
          <button
            type="button"
            aria-label="Close navigation"
            tabIndex={drawerOpen ? 0 : -1}
            className={`md:hidden fixed inset-0 z-30 bg-near-black/40 backdrop-blur-sm transition-opacity duration-200 ease-out ${
              drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            onClick={() => setDrawerOpen(false)}
          />

          <Sidebar
            open={drawerOpen}
            onNavigate={handleNavigate}
            onWikiToggle={handleWikiToggle}
            wikiDrawerOpen={wikiDrawerOpen}
            resize={resize}
          />

          <WikiDrawer open={wikiDrawerOpen} onClose={() => setWikiDrawerOpen(false)} />

          <main className="flex-1 min-w-0 min-h-0 overflow-hidden relative bg-canvas">
            <Routes>
              <Route path="/" element={<ChatPage />} />
              <Route path="/wiki" element={<WikiPage />} />
              <Route path="/wiki/:slug" element={<WikiPage />} />
              <Route path="/ingest" element={<IngestPage />} />
            </Routes>
          </main>

          {/* Snap-to-collapse hint band — visible while dragging near the threshold */}
          <div
            aria-hidden
            className={`hidden md:block fixed left-0 top-14 bottom-0 w-16 pointer-events-none z-[25] transition-opacity duration-150 ease-out ${
              resize.snapHint ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              background:
                'linear-gradient(90deg, rgba(201,100,66,0.08), transparent)',
            }}
          />
        </div>
      </div>
    </SessionGate>
  )
}

