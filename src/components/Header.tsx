import { Leaf, Mic, ShieldCheck, Sparkles, Type } from "lucide-react";

import type { InteractionMode } from "@/lib/client/engineClient";
import type { ServerStatus } from "@/lib/client/useCallSession";
import { Badge, StatusDot } from "./ui";

function serviceTone(status: ServerStatus): {
  tone: "green" | "amber" | "rust" | "neutral";
  label: string;
  pulse: boolean;
} {
  switch (status) {
    case "online":
      return { tone: "green", label: "Support engine online", pulse: false };
    case "offline":
      return { tone: "rust", label: "Server unavailable — in-browser engine", pulse: false };
    default:
      return { tone: "neutral", label: "Checking services…", pulse: true };
  }
}

export function Header({
  mounted,
  interactionMode,
  serverStatus,
  localAIAvailable,
}: {
  mounted: boolean;
  interactionMode: InteractionMode;
  serverStatus: ServerStatus;
  localAIAvailable: boolean;
}) {
  const service = serviceTone(serverStatus);
  const modeLabel = !mounted
    ? "Detecting…"
    : interactionMode === "browser-voice"
      ? "Browser Voice"
      : "Text Fallback";
  const ModeIcon =
    !mounted ? Sparkles : interactionMode === "browser-voice" ? Mic : Type;

  return (
    <header className="border-b border-line bg-canvas/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-forest/20 bg-forest text-canvas"
          >
            <Leaf size={18} strokeWidth={1.75} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[19px] font-semibold leading-none tracking-[-0.02em] text-ink">
                Aura Voice CX
              </h1>
            </div>
            <p className="mt-1 text-[13px] italic text-muted">
              Thoughtful support. Naturally.
            </p>
            <p className="mt-1 max-w-md text-[12.5px] leading-snug text-faint">
              A voice support workspace for Aura Skincare, with deterministic
              order tools and policy enforcement.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="amber">
            <ShieldCheck size={12} aria-hidden /> Demo data only
          </Badge>
          <Badge tone="forest">
            <ModeIcon size={12} aria-hidden /> Mode: {modeLabel}
          </Badge>
          {localAIAvailable ? (
            <Badge tone="sage">
              <Sparkles size={12} aria-hidden /> Local AI available
            </Badge>
          ) : null}
          <span
            className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] font-medium text-muted"
            role="status"
            aria-live="polite"
          >
            <StatusDot tone={service.tone} pulse={service.pulse} />
            {service.label}
          </span>
        </div>
      </div>
    </header>
  );
}
