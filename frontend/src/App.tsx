import { Routes, Route } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { ChatPage } from './pages/ChatPage'
import { WikiPage } from './pages/WikiPage'
import { IngestPage } from './pages/IngestPage'

export function App() {
  return (
    <div className="flex flex-col h-screen bg-parchment">
      {/* Top nav */}
      <header className="h-13 flex items-center justify-between px-6 border-b border-border-cream bg-parchment flex-shrink-0">
        <span className="font-serif text-base font-medium text-near-black">Knowledge Base</span>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
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
  )
}
