import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ChatMessage } from '../ChatMessage'
import type { ChatMessage as ChatMessageType } from '../../lib/types'

function renderInRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

const userMsg: ChatMessageType = {
  id: '1', role: 'user', content: 'How do I deploy?', citations: []
}

const assistantMsg: ChatMessageType = {
  id: '2', role: 'assistant', content: 'Run `make deploy`.', citations: ['deploy-process']
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

  it('renders citation tags for assistant messages', () => {
    renderInRouter(<ChatMessage message={assistantMsg} />)
    expect(screen.getByText('deploy-process')).toBeInTheDocument()
  })

  it('does not render citations for user messages', () => {
    renderInRouter(<ChatMessage message={userMsg} />)
    expect(screen.queryByText('deploy-process')).not.toBeInTheDocument()
  })
})
