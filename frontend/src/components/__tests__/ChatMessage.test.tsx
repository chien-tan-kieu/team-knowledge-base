import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { ChatMessage } from '../ChatMessage'
import type { ChatMessage as ChatMessageType } from '../../lib/types'

function renderInRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

const userMsg: ChatMessageType = {
  id: '1', role: 'user', content: 'How do I deploy?', citations: []
}

const assistantMsg: ChatMessageType = {
  id: '2', role: 'assistant', content: 'Run `make deploy`.', citations: [{ slug: 'deploy-process', start: 1, end: 5 }]
}

describe('ChatMessage', () => {
  it('renders user message content', () => {
    renderInRouter(<ChatMessage message={userMsg} />)
    expect(screen.getByText('How do I deploy?')).toBeInTheDocument()
  })

  it('renders assistant message content', () => {
    renderInRouter(<ChatMessage message={assistantMsg} />)
    expect(screen.getByText(/make deploy/)).toBeInTheDocument()
  })

  it('renders citation numbers and sources section for assistant messages', () => {
    renderInRouter(<ChatMessage message={assistantMsg} />)
    expect(screen.getByText('Sources')).toBeInTheDocument()
    expect(screen.getByText('deploy-process')).toBeInTheDocument()
  })

  it('does not render citations for user messages', () => {
    renderInRouter(<ChatMessage message={userMsg} />)
    expect(screen.queryByText('Sources')).not.toBeInTheDocument()
  })
})
