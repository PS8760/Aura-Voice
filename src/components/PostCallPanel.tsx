"use client";

import { useMemo, useState } from "react";
import {
  BadgeCheck,
  Check,
  Clipboard,
  Download,
  FileJson,
  FileText,
  ListChecks,
  Search,
  TriangleAlert,
} from "lucide-react";

import {
  outcomeToFileName,
  outcomeToJson,
  transcriptFileName,
  type CallOutcome,
} from "@/lib/domain/outcome";
import {
  filterTranscript,
  formatTranscriptText,
  type Speaker,
  type TranscriptTurn,
} from "@/lib/domain/transcript";
import { intentLabel, resolutionLabel } from "@/lib/client/labels";
import { copyToClipboard, downloadText } from "@/lib/client/download";
import { cn } from "@/lib/client/cn";
import { Badge, Card, SectionHeader } from "./ui";

const SPEAKERS: Array<{ id: Speaker | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "customer", label: "Customer" },
  { id: "agent", label: "Aria" },
];

const ACTION_TONE: Record<
  CallOutcome["actions_executed"][number]["status"],
  "forest" | "amber" | "rust"
> = {
  executed: "forest",
  not_executed: "amber",
  blocked: "rust",
};

function resolutionTone(
  status: CallOutcome["resolution_status"],
): "forest" | "amber" | "rust" | "neutral" {
  switch (status) {
    case "RESOLVED":
      return "forest";
    case "ESCALATION_REQUIRED":
      return "amber";
    case "OUT_OF_SCOPE":
      return "neutral";
    default:
      return "rust";
  }
}

export function PostCallPanel({
  outcome,
  transcript,
}: {
  outcome: CallOutcome;
  transcript: TranscriptTurn[];
}) {
  const [speaker, setSpeaker] = useState<Speaker | "all">("all");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(
    () => filterTranscript(transcript, { speaker, query }),
    [transcript, speaker, query],
  );

  const json = outcomeToJson(outcome);

  const handleCopy = async () => {
    const ok = await copyToClipboard(json);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <Card as="section" className="overflow-hidden">
      <SectionHeader
        title="Post-call outcome"
        hint="Validated structured result for this session"
        icon={<ListChecks size={16} />}
        action={
          <Badge tone={resolutionTone(outcome.resolution_status)}>
            {resolutionLabel(outcome.resolution_status)}
          </Badge>
        }
      />

      <div className="grid gap-0 lg:grid-cols-2">
        <div className="space-y-4 border-b border-line px-4 py-4 sm:px-5 lg:border-b-0 lg:border-r">
          <dl className="grid grid-cols-2 gap-3 text-[12.5px]">
            <div>
              <dt className="text-faint">Customer intent</dt>
              <dd className="mt-0.5 font-medium text-charcoal">
                {intentLabel(outcome.customer_intent)}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Order ID</dt>
              <dd className="mt-0.5 font-mono text-charcoal">
                {outcome.order_id ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Resolution</dt>
              <dd className="mt-0.5 font-medium text-charcoal">
                {resolutionLabel(outcome.resolution_status)}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Mode</dt>
              <dd className="mt-0.5 text-charcoal">{outcome.mode}</dd>
            </div>
          </dl>

          <div>
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
              Call summary
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-charcoal">
              {outcome.call_summary}
            </p>
          </div>

          <div>
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
              Actions executed
            </h3>
            {outcome.actions_executed.length === 0 ? (
              <p className="mt-1 text-[12.5px] text-faint">
                No actions were executed during this session.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {outcome.actions_executed.map((action) => (
                  <li
                    key={action.id}
                    className="flex items-start justify-between gap-3 rounded-[9px] border border-line bg-canvas px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-charcoal">
                        {action.type.replace(/_/g, " ")}
                        {action.orderId ? ` · ${action.orderId}` : ""}
                      </p>
                      <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
                        {action.detail}
                      </p>
                    </div>
                    <Badge tone={ACTION_TONE[action.status]}>
                      {action.status.replace(/_/g, " ")}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
              Unresolved issues
            </h3>
            {outcome.unresolved_issues.length === 0 ? (
              <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-forest">
                <BadgeCheck size={14} aria-hidden /> Nothing outstanding.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {outcome.unresolved_issues.map((issue) => (
                  <li
                    key={issue}
                    className="flex items-start gap-2 rounded-[9px] border border-amber/25 bg-amber-soft px-3 py-2 text-[12px] text-amber"
                  >
                    <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-col px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
              Transcript
            </h3>
            <div className="flex items-center gap-1.5">
              {SPEAKERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSpeaker(option.id)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                    speaker === option.id
                      ? "border-forest bg-forest text-canvas"
                      : "border-line bg-panel text-muted hover:border-line-strong",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative mt-2">
            <Search
              size={13}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <label htmlFor="transcript-search" className="sr-only">
              Search transcript
            </label>
            <input
              id="transcript-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search an order ID or phrase"
              className="w-full rounded-full border border-line bg-canvas py-2 pl-8 pr-3 text-[12.5px] text-charcoal placeholder:text-faint"
            />
          </div>

          <ul className="scroll-slim mt-3 max-h-[260px] flex-1 space-y-2 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <li className="py-6 text-center text-[12px] text-faint">
                No matching transcript turns.
              </li>
            ) : (
              filtered.map((turn) => (
                <li
                  key={turn.id}
                  className="rounded-[9px] border border-line bg-canvas px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      {turn.speaker === "customer"
                        ? "Customer"
                        : turn.speaker === "agent"
                          ? "Aria"
                          : "System"}
                    </span>
                    {turn.source === "scenario" ? (
                      <span className="text-[10px] text-faint">scripted</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-charcoal">
                    {turn.text}
                  </p>
                </li>
              ))
            )}
          </ul>

          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-panel px-3 py-1.5 text-[12px] font-medium text-charcoal hover:border-forest hover:text-forest"
            >
              {copied ? <Check size={13} aria-hidden /> : <Clipboard size={13} aria-hidden />}
              {copied ? "Copied" : "Copy JSON"}
            </button>
            <button
              type="button"
              onClick={() =>
                downloadText(
                  transcriptFileName(),
                  formatTranscriptText(transcript),
                )
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-panel px-3 py-1.5 text-[12px] font-medium text-charcoal hover:border-forest hover:text-forest"
            >
              <FileText size={13} aria-hidden /> Transcript .txt
            </button>
            <button
              type="button"
              onClick={() =>
                downloadText(outcomeToFileName(outcome), json, "application/json")
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-forest bg-forest px-3 py-1.5 text-[12px] font-medium text-canvas hover:bg-forest-deep"
            >
              <Download size={13} aria-hidden /> Outcome .json
            </button>
          </div>
        </div>
      </div>

      <details className="border-t border-line px-4 py-3 sm:px-5">
        <summary className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
          <FileJson size={13} aria-hidden /> Structured JSON
        </summary>
        <pre className="scroll-slim mt-2 max-h-[240px] overflow-auto rounded-[10px] border border-line bg-canvas p-3 font-mono text-[11.5px] leading-relaxed text-charcoal">
          {json}
        </pre>
      </details>
    </Card>
  );
}
