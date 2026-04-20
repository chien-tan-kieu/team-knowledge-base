import { useRef, useEffect } from "react";
import { ChatMessage } from "../components/ChatMessage";
import { ChatInput } from "../components/ChatInput";
import { ErrorBanner } from "../components/ErrorBanner";
import { PreviewPanel } from "../components/PreviewPanel";
import { useChat } from "../hooks/useChat";

const SUGGESTIONS: Array<{ tag: string; q: string }> = [
  { tag: "Deploy", q: "How do we ship to production safely?" },
  {
    tag: "Onboarding",
    q: "What does the first week look like for a new engineer?",
  },
  { tag: "Architecture", q: "Why did we pick Postgres over DynamoDB?" },
  { tag: "Process", q: "Walk me through our incident response runbook." },
];

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-col items-start gap-7 pt-14 pb-10 animate-[riseIn_0.6s_var(--ease-out)]">
      <span
        aria-hidden
        className="w-[72px] h-[72px] grid place-items-center text-accent opacity-95"
      >
        <svg
          className="w-full h-full"
          viewBox="0 0 64 64"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14 10h26l10 10v34H14z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M40 10v10h10" />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20 28h24M20 36h24M20 44h16"
          />
          <circle cx="44" cy="44" r="7" fill="currentColor" opacity="0.12" />
        </svg>
      </span>

      <h1
        className="font-serif text-[40px] leading-[1.1] tracking-[-0.025em] m-0 italic text-fg"
        style={{ fontVariationSettings: '"opsz" 144', fontWeight: 400 }}
      >
        What would you like to <span className="italic text-accent">know</span>?
      </h1>

      <p
        className="font-serif text-[18px] leading-[1.55] text-fg-muted m-0 max-w-[52ch]"
        style={{ fontVariationSettings: '"opsz" 24' }}
      >
        Ask in plain language. Answers come from your team's own documents —
        every sentence traceable, every source one tap away.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full mt-1">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.q}
            type="button"
            onClick={() => onPick(s.q)}
            className="group relative text-left p-4 bg-surface rounded-xl overflow-hidden transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5"
            style={{ boxShadow: "var(--shadow-ring)" }}
          >
            <span
              aria-hidden
              className="absolute left-0 top-0 bottom-0 w-[3px] bg-accent origin-center scale-y-0 group-hover:scale-y-100 transition-transform duration-300"
              style={{ transitionTimingFunction: "var(--ease-spring)" }}
            />
            <span className="inline-flex items-center gap-1.5 mb-2 text-[10.5px] font-medium uppercase tracking-[0.12em] text-accent">
              <span className="font-serif" aria-hidden>
                ✱
              </span>
              {s.tag}
            </span>
            <span
              className="block font-serif text-[15.5px] leading-[1.4] text-fg"
              style={{ fontVariationSettings: '"opsz" 14' }}
            >
              {s.q}
            </span>
          </button>
        ))}
      </div>

      <div className="inline-flex items-center gap-2.5 text-fg-dim text-[12.5px] mt-1">
        <span
          className="w-10 border-t border-dashed"
          style={{ borderColor: "var(--color-line-strong)" }}
        />
        or type your own below
      </div>
    </div>
  );
}

export function ChatPage() {
  const { messages, streaming, sendMessage, stop, error, editLast, newChat } = useChat();
  const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-[740px] mx-auto px-5 sm:px-8 pt-6">
          {!hasMessages && !error && <EmptyState onPick={sendMessage} />}
          {hasMessages && (
            <>
              <div className="flex justify-end mb-3">
                <button
                  type="button"
                  onClick={newChat}
                  disabled={streaming}
                  className="text-[12px] font-sans text-fg-dim hover:text-fg px-2.5 py-1 rounded-md border border-line-strong bg-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  New chat
                </button>
              </div>
              <div className="flex flex-col gap-9 pb-6">
                {messages.map((msg, idx) => (
                  <ChatMessage
                    key={msg.id}
                    message={msg}
                    editable={!streaming && idx === lastUserIdx}
                    onEditSave={editLast}
                  />
                ))}
              </div>
            </>
          )}
          {error && (
            <div className="mt-6">
              <ErrorBanner error={error} />
            </div>
          )}
          {streaming &&
            !messages.some(
              (m) => m.role === "assistant" && m.content === "",
            ) && (
              <p className="text-fg-dim text-xs font-sans animate-pulse mt-3">
                Thinking…
              </p>
            )}
          <div ref={bottomRef} />
          <PreviewPanel />
        </div>
      </div>

      <div
        className="px-5 sm:px-8 pt-4 pb-5 pb-safe mb-2"
        style={{
          background:
            "linear-gradient(180deg, transparent, var(--color-canvas) 30%)",
        }}
      >
        <ChatInput onSend={sendMessage} streaming={streaming} onStop={stop} disabled={streaming} />
      </div>
    </div>
  );
}
