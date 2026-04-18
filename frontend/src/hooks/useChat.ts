import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../stores/chatStore'

export function useChat() {
  return useChatStore(useShallow(s => ({
    messages: s.messages,
    streaming: s.streaming,
    error: s.error,
    sendMessage: s.send,
    stop: s.stop,
    editLast: s.editLast,
    newChat: s.newChat,
  })))
}
