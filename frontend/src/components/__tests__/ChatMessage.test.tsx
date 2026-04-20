import { render, screen, fireEvent } from '@testing-library/react'
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

  it('enters edit mode when the last user bubble is clicked', () => {
    const msg: ChatMessageType = { id: '1', role: 'user', content: 'hi', citations: [] }
    render(<MemoryRouter><ChatMessage message={msg} editable onEditSave={() => {}} /></MemoryRouter>)
    fireEvent.click(screen.getByText('hi'))
    expect(screen.getByRole('textbox')).toHaveValue('hi')
  })

  it('does not enter edit mode when not editable', () => {
    const msg: ChatMessageType = { id: '1', role: 'user', content: 'hi', citations: [] }
    render(<MemoryRouter><ChatMessage message={msg} /></MemoryRouter>)
    fireEvent.click(screen.getByText('hi'))
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('Enter activates edit mode on the editable bubble', () => {
    const msg: ChatMessageType = { id: '1', role: 'user', content: 'hi', citations: [] }
    render(<MemoryRouter><ChatMessage message={msg} editable onEditSave={() => {}} /></MemoryRouter>)
    // Focus the bubble via the role=button target, then press Enter.
    const bubble = screen.getByRole('button')
    bubble.focus()
    fireEvent.keyDown(bubble, { key: 'Enter' })
    expect(screen.getByRole('textbox')).toHaveValue('hi')
  })

  it('Space activates edit mode on the editable bubble', () => {
    const msg: ChatMessageType = { id: '1', role: 'user', content: 'hi', citations: [] }
    render(<MemoryRouter><ChatMessage message={msg} editable onEditSave={() => {}} /></MemoryRouter>)
    const bubble = screen.getByRole('button')
    fireEvent.keyDown(bubble, { key: ' ' })
    expect(screen.getByRole('textbox')).toHaveValue('hi')
  })

  it('closes the editor when editable flips to false', () => {
    const msg: ChatMessageType = { id: '1', role: 'user', content: 'hi', citations: [] }
    const { rerender } = render(
      <MemoryRouter><ChatMessage message={msg} editable onEditSave={() => {}} /></MemoryRouter>
    )
    fireEvent.click(screen.getByText('hi'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    rerender(
      <MemoryRouter><ChatMessage message={msg} editable={false} onEditSave={() => {}} /></MemoryRouter>
    )
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
