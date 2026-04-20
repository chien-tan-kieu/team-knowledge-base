import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

interface Props {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled = false }: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div
      className="w-full max-w-[740px] mx-auto grid grid-cols-[1fr_auto] items-end gap-2 bg-surface rounded-2xl pl-4 pr-1.5 py-1.5 transition-[box-shadow] duration-200 ease-out focus-within:[box-shadow:0_18px_60px_rgba(20,20,19,0.1),0_0_0_1px_var(--color-accent)]"
      style={{ boxShadow: "var(--shadow-elevated)" }}
    >
      <div className="flex flex-col gap-2 py-2 min-w-0">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything about your team's knowledge…"
          rows={1}
          disabled={disabled}
          autoComplete="off"
          className="w-full resize-none bg-transparent border-0 outline-none text-[15px] leading-[1.5] text-fg placeholder:text-fg-dim font-sans tracking-[-0.003em] max-h-[180px] overflow-y-auto"
        />
        <div className="flex items-center gap-1.5 text-fg-dim text-[11.5px]">
          <button
            type="button"
            title="Attach file"
            aria-label="Attach file"
            className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full bg-canvas text-fg-muted font-sans text-[11px] tracking-[0.02em] hover:bg-sand hover:text-fg transition-colors duration-150"
            style={{ boxShadow: "var(--shadow-ring)" }}
          >
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              viewBox="0 0 24 24"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m21 11-9.5 9.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5L9.5 18.5a2 2 0 0 1-3-3l8-8" />
            </svg>
            Attach
          </button>
          <span
            className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full bg-canvas text-fg-muted font-sans text-[11px] tracking-[0.02em] cursor-default select-none"
            style={{ boxShadow: "var(--shadow-ring)" }}
          >
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 12h16M4 18h10"
              />
            </svg>
            Grounded in wiki
          </span>
          <span className="ml-auto hidden sm:flex items-center gap-1.5 text-[11px] text-fg-dim">
            <kbd
              className="font-mono text-[10.5px] font-medium px-1.5 py-0.5 rounded bg-elevated text-fg-muted"
              style={{ border: "1px solid var(--color-line-strong)" }}
            >
              Enter
            </kbd>
            to send
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        aria-label="Send message"
        className="w-11 h-11 mr-0.5 my-0.5 rounded-xl bg-accent text-fg-onaccent grid place-items-center transition-[transform,background] duration-200 hover:scale-[1.04] disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
      >
        <svg
          className="w-[18px] h-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 12h14M13 6l6 6-6 6"
          />
        </svg>
      </button>
    </div>
  );
}
