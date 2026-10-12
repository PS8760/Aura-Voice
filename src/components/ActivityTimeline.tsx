"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  CircleHelp,
  Flag,
  Info,
  ScanSearch,
  ShieldCheck,
  Tag,
} from "lucide-react";
import type { ReactNode } from "react";

import type { ActivityEvent, ActivityEventType } from "@/lib/domain/orchestrator";
import { cn } from "@/lib/client/cn";
import { Card, SectionHeader } from "./ui";

const ICONS: Record<ActivityEventType, ReactNode> = {
  intent_detected: <Tag size={13} />,
  order_identified: <ScanSearch size={13} />,
  order_missing: <AlertTriangle size={13} />,
  order_unknown: <AlertTriangle size={13} />,
  order_service_queried: <ScanSearch size={13} />,
  policy_checked: <ShieldCheck size={13} />,
  result_returned: <BadgeCheck size={13} />,
  clarification_requested: <CircleHelp size={13} />,
  out_of_scope: <Ban size={13} />,
  outcome_finalized: <Flag size={13} />,
};

const STATUS_COLOR: Record<ActivityEvent["status"], string> = {
  info: "text-muted",
  ok: "text-forest",
  warn: "text-amber",
  error: "text-rust",
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

export function ActivityTimeline({
  activity,
}: {
  activity: ActivityEvent[];
}) {
  return (
    <Card className="flex flex-col">
      <SectionHeader
        title="Tool activity"
        hint="Only actions that actually occurred"
        icon={<Info size={16} />}
        action={
          <span className="font-mono text-[11px] text-faint">
            {activity.length} event{activity.length === 1 ? "" : "s"}
          </span>
        }
      />
      <div className="scroll-slim max-h-[240px] overflow-y-auto px-4 py-3 sm:px-5">
        {activity.length === 0 ? (
          <p className="py-4 text-center text-xs text-faint">
            No tool activity yet. Start a call, ask a question, or run a
            scenario.
          </p>
        ) : (
          <ol className="relative space-y-3 border-l border-line pl-4">
            {activity.map((event) => (
              <li key={event.id} className="relative">
                <span
                  className={cn(
                    "absolute -left-[21px] mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-panel",
                    STATUS_COLOR[event.status],
                  )}
                  aria-hidden
                >
                  {ICONS[event.type] ?? <Info size={12} />}
                </span>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[12.5px] font-medium text-charcoal">
                    {event.label}
                  </p>
                  <time className="shrink-0 font-mono text-[10.5px] text-faint">
                    {formatTime(event.at)}
                  </time>
                </div>
                <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
                  {event.detail}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
