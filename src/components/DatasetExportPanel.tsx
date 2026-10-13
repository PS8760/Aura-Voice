"use client";

import { useState, useTransition } from "react";
import { Download, GraduationCap } from "lucide-react";

import { Badge, Card, SectionHeader } from "@/components/ui";
import type { DatasetStats } from "@/lib/server/rag";

import { exportDatasetAction } from "@/app/admin/actions";

/**
 * Exports a supervised fine-tuning dataset built from real, guardrail-passing
 * sessions and approved knowledge. The download is chat JSONL, ready for the
 * LoRA pipeline in `scripts/finetune`.
 */
export function DatasetExportPanel() {
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await exportDatasetAction();
      if (!result) return;
      setStats(result.stats);
      const blob = new Blob([result.jsonl], { type: "application/jsonl" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "aura-support-sft.jsonl";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <Card className="mt-6">
      <SectionHeader
        title="Fine-tuning dataset"
        hint="Export only the interactions that already passed the guardrails, as chat JSONL for a LoRA run."
        icon={<GraduationCap size={16} aria-hidden />}
        action={
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-forest/30 bg-forest px-3.5 py-1.5 text-[12.5px] font-medium text-canvas transition-colors hover:bg-forest-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download size={13} aria-hidden />
            {pending ? "Building…" : "Export dataset"}
          </button>
        }
      />

      <div className="px-4 py-4 sm:px-5">
        {!stats ? (
          <p className="text-[13px] text-muted">
            Fine-tuning is optional and runs where compute exists. Retrieval already
            improves answers today; this dataset is what you would feed to a LoRA
            trainer so the model internalises the house tone and grounding discipline.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={stats.total > 0 ? "sage" : "amber"}>
                {stats.total} training example{stats.total === 1 ? "" : "s"}
              </Badge>
              <span className="text-[11.5px] text-faint">
                {stats.fromSessions} from resolved sessions · {stats.fromKnowledge} from
                approved knowledge
              </span>
            </div>
            {stats.total === 0 ? (
              <p className="text-[12.5px] text-muted">
                No qualifying examples yet. Resolve a few calls and approve their
                knowledge entries — only verified interactions are exported.
              </p>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-2">
                {Object.entries(stats.byIntent)
                  .sort((a, b) => b[1] - a[1])
                  .map(([intent, count]) => (
                    <li
                      key={intent}
                      className="flex items-center justify-between rounded-[9px] border border-line bg-canvas px-3 py-1.5 text-[12px]"
                    >
                      <span className="text-muted">{intent}</span>
                      <span className="font-medium text-ink">{count}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
