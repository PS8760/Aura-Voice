"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, FlaskConical, Play, XCircle } from "lucide-react";

import { Badge, Card, SectionHeader } from "@/components/ui";
import type { EvalResult } from "@/lib/server/evaluation";

import { runEvaluationAction } from "@/app/admin/actions";

export function EvaluationPanel({ scenarios }: { scenarios: number }) {
  const [results, setResults] = useState<EvalResult[] | null>(null);
  const [pending, startTransition] = useTransition();

  const passed = results?.filter((result) => result.passed).length ?? 0;
  const total = results?.length ?? 0;

  function run() {
    startTransition(async () => {
      const next = await runEvaluationAction();
      setResults(next);
    });
  }

  return (
    <Card className="mt-6">
      <SectionHeader
        title="Agent evaluation"
        hint={`Replays the ${scenarios} assessment scenarios against the real engine, on a fixed clock.`}
        icon={<FlaskConical size={16} aria-hidden />}
        action={
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-forest/30 bg-forest px-3.5 py-1.5 text-[12.5px] font-medium text-canvas transition-colors hover:bg-forest-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Play size={13} aria-hidden />
            {pending ? "Running…" : "Run evaluation"}
          </button>
        }
      />

      <div className="px-4 py-4 sm:px-5">
        {!results ? (
          <p className="text-[13px] text-muted">
            Run the harness to check that each scenario still produces the outcome it
            promises. Nothing is mocked — every run drives the production orchestrator
            against a fresh in-memory order store.
          </p>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <Badge tone={passed === total ? "sage" : "rust"}>
                {passed}/{total} scenarios passed
              </Badge>
              <span className="text-[11.5px] text-faint">
                Fixed clock 2026-01-01T10:00Z · deterministic
              </span>
            </div>
            <ul className="space-y-2.5">
              {results.map((result) => (
                <li
                  key={result.id}
                  className="rounded-[11px] border border-line bg-canvas p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {result.passed ? (
                        <CheckCircle2 size={15} className="text-forest" aria-hidden />
                      ) : (
                        <XCircle size={15} className="text-rust" aria-hidden />
                      )}
                      <span className="text-[13px] font-medium text-ink">{result.label}</span>
                    </div>
                    <Badge tone={result.passed ? "sage" : "rust"}>
                      {result.passed ? "Pass" : "Fail"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[12px] text-muted">{result.description}</p>
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {result.checks.map((entry) => (
                      <li
                        key={entry.label}
                        className="flex items-start gap-1.5 text-[12px] text-muted"
                      >
                        <span
                          className={entry.passed ? "text-forest" : "text-rust"}
                          aria-hidden
                        >
                          {entry.passed ? "✓" : "✗"}
                        </span>
                        {entry.label}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
