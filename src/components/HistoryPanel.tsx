"use client";

import { History, Trash2 } from "lucide-react";

import type { CallOutcome } from "@/lib/domain/outcome";
import { intentLabel, resolutionLabel } from "@/lib/client/labels";
import { cn } from "@/lib/client/cn";
import { Card, SectionHeader } from "./ui";

function resolutionTone(status: CallOutcome["resolution_status"]): string {
  switch (status) {
    case "RESOLVED":
      return "text-forest";
    case "ESCALATION_REQUIRED":
      return "text-amber";
    case "OUT_OF_SCOPE":
      return "text-muted";
    default:
      return "text-rust";
  }
}

export function HistoryPanel({
  history,
  onClear,
}: {
  history: CallOutcome[];
  onClear: () => void;
}) {
  return (
    <Card>
      <SectionHeader
        title="Recent sessions"
        hint="Stored in this browser only"
        icon={<History size={16} />}
        action={
          history.length > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-panel px-2.5 py-0.5 text-[11px] font-medium text-muted hover:border-rust hover:text-rust"
            >
              <Trash2 size={11} aria-hidden /> Clear
            </button>
          ) : undefined
        }
      />
      <div className="px-4 py-3 sm:px-5">
        {history.length === 0 ? (
          <p className="py-2 text-[12px] text-faint">
            No completed sessions yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {history.map((item) => (
              <li
                key={`${item.generated_at}-${item.order_id ?? "none"}`}
                className="flex items-start justify-between gap-3 rounded-[9px] border border-line bg-canvas px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium text-charcoal">
                    {intentLabel(item.customer_intent)}
                    {item.order_id ? ` · ${item.order_id}` : ""}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-faint">
                    {item.call_summary}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-[11px] font-medium",
                    resolutionTone(item.resolution_status),
                  )}
                >
                  {resolutionLabel(item.resolution_status)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          Session history is saved only in this browser&apos;s local storage. It is
          not sent to the server and is not visible on other devices.
        </p>
      </div>
    </Card>
  );
}
