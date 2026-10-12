"use client";

import {
  AlertTriangle,
  Headphones,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";

import type { CallSessionApi, CallStatus } from "@/lib/client/useCallSession";
import { useReducedMotionPreference } from "@/lib/client/useReducedMotion";
import { cn } from "@/lib/client/cn";
import { VoiceOrb } from "./VoiceOrb";
import { Badge, Card } from "./ui";

const STATUS_LABEL: Record<CallStatus, string> = {
  idle: "Ready",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Error",
  ended: "Ended",
};

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function VoiceWorkspace({ session }: { session: CallSessionApi }) {
  const reducedMotion = useReducedMotionPreference();
  const {
    mounted,
    status,
    statusMessage,
    errorMessage,
    errorRecoverable,
    capabilities,
    micPermission,
    elapsedSeconds,
    speakEnabled,
    getMicLevel,
    startCall,
    endCall,
    resumeListening,
    setSpeakEnabled,
  } = session;

  const isActive =
    status === "connecting" ||
    status === "listening" ||
    status === "thinking" ||
    status === "speaking";

  const startDisabled =
    !mounted || !capabilities.recognition || isActive;
  const endDisabled = !isActive;

  const statusTone =
    status === "error"
      ? "rust"
      : status === "listening"
        ? "sage"
        : status === "speaking"
          ? "forest"
          : "neutral";

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-full border border-forest/20 bg-forest-tint text-forest-deep"
          >
            <Headphones size={16} strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">Aria</p>
            <p className="text-xs text-muted">
              Aura Skincare support specialist
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={statusTone as "rust" | "sage" | "forest" | "neutral"}>
            {STATUS_LABEL[status]}
          </Badge>
          <span
            className="font-mono text-xs tabular-nums text-muted"
            aria-label={`Call duration ${formatDuration(elapsedSeconds)}`}
          >
            {formatDuration(elapsedSeconds)}
          </span>
        </div>
      </div>

      <div className="paper-grid flex flex-col items-center px-4 py-6 sm:px-6">
        <VoiceOrb
          status={status}
          getLevel={getMicLevel}
          reducedMotion={reducedMotion}
        />

        <p
          className="mt-5 max-w-md text-balance text-center text-[13.5px] leading-relaxed text-muted"
          aria-live="polite"
        >
          {errorMessage ?? statusMessage}
        </p>

        <div className="mt-5 flex w-full max-w-sm items-center justify-center gap-3">
          <button
            type="button"
            onClick={startCall}
            disabled={startDisabled}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium transition-colors",
              startDisabled
                ? "cursor-not-allowed border-line bg-parchment text-faint"
                : "border-forest bg-forest text-canvas hover:bg-forest-deep",
            )}
          >
            <PhoneCall size={16} strokeWidth={1.9} /> Start Call
          </button>
          <button
            type="button"
            onClick={endCall}
            disabled={endDisabled}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium transition-colors",
              endDisabled
                ? "cursor-not-allowed border-line bg-parchment text-faint"
                : "border-line-strong bg-panel text-charcoal hover:border-rust hover:text-rust",
            )}
          >
            <PhoneOff size={16} strokeWidth={1.9} /> End Call
          </button>
        </div>

        {status === "error" && errorRecoverable ? (
          <button
            type="button"
            onClick={resumeListening}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-forest underline underline-offset-4 hover:text-forest-deep"
          >
            <RotateCcw size={13} /> Try resuming the session
          </button>
        ) : null}

        <div className="mt-5 flex w-full flex-col gap-3 border-t border-line pt-4 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 sm:max-w-[62%]">
            {micPermission === "denied" ? (
              <MicOff size={14} className="mt-0.5 shrink-0 text-rust" aria-hidden />
            ) : (
              <Mic size={14} className="mt-0.5 shrink-0 text-forest" aria-hidden />
            )}
            <span>
              Aria uses your browser microphone only while the call is active.
              Nothing is uploaded or stored on a server. If access is blocked,
              type your message in the conversation panel instead.
            </span>
          </p>
          <label className="inline-flex cursor-pointer select-none items-center gap-2">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-[var(--color-forest)]"
              checked={speakEnabled}
              disabled={!capabilities.synthesis}
              onChange={(event) => setSpeakEnabled(event.target.checked)}
            />
            {speakEnabled && capabilities.synthesis ? (
              <Volume2 size={14} aria-hidden />
            ) : (
              <VolumeX size={14} aria-hidden />
            )}
            <span>Spoken replies</span>
          </label>
        </div>

        {!mounted ? null : !capabilities.recognition ? (
          <div className="mt-4 flex w-full items-start gap-2 rounded-[10px] border border-amber/30 bg-amber-soft px-3 py-2.5 text-xs text-amber">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Live speech recognition is unavailable in this browser, so Start
              Call is disabled. Type your message below — it uses the exact same
              order tools and policy engine as voice.
            </span>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
