"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, SendHorizontal } from "lucide-react";

import type { CallSessionApi, CallStatus } from "@/lib/client/useCallSession";
import { intentLabel } from "@/lib/client/labels";
import { cn } from "@/lib/client/cn";
import type { TranscriptTurn } from "@/lib/domain/transcript";
import { Card, SectionHeader } from "./ui";

const LIVE_LABEL: Record<CallStatus, string> = {
  idle: "Idle",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Needs attention",
  ended: "Ended",
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function Bubble({ turn }: { turn: TranscriptTurn }) {
  if (turn.speaker === "system") {
    return (
      <li className="my-1 flex justify-center">
        <p className="max-w-[92%] rounded-full border border-dashed border-line-strong bg-parchment/60 px-3 py-1.5 text-center text-[11px] text-muted">
          {turn.text}
        </p>
      </li>
    );
  }

  const isCustomer = turn.speaker === "customer";
  return (
    <li
      className={cn("flex flex-col gap-1", isCustomer ? "items-end" : "items-start")}
    >
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {isCustomer ? "Customer" : "Aria"}
        </span>
        <span className="text-[10.5px] text-faint">{formatTime(turn.at)}</span>
        {turn.source === "scenario" ? (
          <span className="rounded-full border border-line px-1.5 text-[10px] text-faint">
            scripted
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          "max-w-[88%] rounded-[13px] border px-3.5 py-2 text-[13.5px] leading-relaxed",
          isCustomer
            ? "border-forest/20 bg-forest text-canvas"
            : "border-line bg-canvas text-charcoal",
        )}
      >
        {turn.text}
      </div>
      {!isCustomer && turn.intent ? (
        <span className="px-1 text-[11px] text-faint">
          Intent · {intentLabel(turn.intent)}
        </span>
      ) : null}
    </li>
  );
}

export function ConversationPanel({ session }: { session: CallSessionApi }) {
  const {
    transcript,
    partialText,
    status,
    scenarioRunning,
    submitText,
    mounted,
  } = session;
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [transcript.length, partialText, status]);

  const send = () => {
    const value = draft.trim();
    if (!value) return;
    submitText(value);
    setDraft("");
  };

  const thinking = status === "thinking";

  return (
    <Card className="flex min-h-[420px] flex-col lg:min-h-0 lg:flex-1">
      <SectionHeader
        title="Live conversation"
        hint="Recognised customer speech and Aria's responses"
        icon={<MessageSquare size={16} />}
        action={
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
              status === "listening" || status === "speaking"
                ? "border-forest/25 bg-forest-tint text-forest-deep"
                : status === "error"
                  ? "border-rust/25 bg-rust-soft text-rust"
                  : "border-line bg-parchment text-muted",
            )}
            role="status"
            aria-live="polite"
          >
            {thinking ? (
              <Loader2 size={11} className="animate-spin" aria-hidden />
            ) : null}
            {LIVE_LABEL[status]}
          </span>
        }
      />

      <ul
        ref={listRef}
        className="scroll-slim flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5"
        aria-label="Conversation transcript"
      >
        {transcript.length === 0 && !partialText ? (
          <li className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-muted">
              No conversation yet.
            </p>
            <p className="max-w-xs text-xs text-faint">
              Start a call or type a message. Try “Where is my order ORD-101?”
            </p>
          </li>
        ) : null}

        {transcript.map((turn) => (
          <Bubble key={turn.id} turn={turn} />
        ))}

        {partialText ? (
          <li className="flex justify-end">
            <div className="max-w-[88%] rounded-[13px] border border-dashed border-forest/30 bg-forest/80 px-3.5 py-2 text-[13.5px] italic text-canvas/90">
              {partialText}…
            </div>
          </li>
        ) : null}

        {thinking ? (
          <li className="flex items-center gap-2 px-1 text-xs text-muted">
            <span className="flex gap-1" aria-hidden>
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sage [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sage [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sage [animation-delay:300ms]" />
            </span>
            Aria is checking that…
          </li>
        ) : null}
      </ul>

      <div className="border-t border-line px-3 py-3 sm:px-4">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <label htmlFor="conversation-input" className="sr-only">
            Type a message to Aria
          </label>
          <input
            id="conversation-input"
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={scenarioRunning}
            placeholder={
              mounted ? "Type a message, e.g. “Cancel order ORD-103”" : "Loading…"
            }
            className="min-w-0 flex-1 rounded-full border border-line bg-canvas px-4 py-2.5 text-[13.5px] text-charcoal placeholder:text-faint disabled:opacity-60"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={scenarioRunning || !draft.trim()}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-medium transition-colors",
              scenarioRunning || !draft.trim()
                ? "cursor-not-allowed border-line bg-parchment text-faint"
                : "border-forest bg-forest text-canvas hover:bg-forest-deep",
            )}
          >
            <SendHorizontal size={15} strokeWidth={2} aria-hidden />
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>
        <p className="mt-2 px-1 text-[11px] text-faint">
          Text uses the same server-side order tools and policy engine as voice.
        </p>
      </div>
    </Card>
  );
}
