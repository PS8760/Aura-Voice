"use client";

import { FlaskConical, Play } from "lucide-react";

import { SCENARIOS, type Scenario } from "@/lib/client/scenarios";
import type { CallSessionApi } from "@/lib/client/useCallSession";
import { cn } from "@/lib/client/cn";
import { Card, SectionHeader } from "./ui";

export function ScenarioLauncher({ session }: { session: CallSessionApi }) {
  const { runScenario, scenarioRunning, activeScenario, status } = session;

  const callBusy =
    !scenarioRunning &&
    (status === "connecting" ||
      status === "listening" ||
      status === "thinking" ||
      status === "speaking");

  const disabled = scenarioRunning || callBusy;

  return (
    <Card>
      <SectionHeader
        title="Try a scenario"
        hint="Scripted playback through the real engine — not live audio"
        icon={<FlaskConical size={16} />}
      />
      <div className="px-4 py-4 sm:px-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SCENARIOS.map((scenario: Scenario) => {
            const active = activeScenario?.id === scenario.id && scenarioRunning;
            return (
              <button
                key={scenario.id}
                type="button"
                onClick={() => runScenario(scenario)}
                disabled={disabled}
                aria-pressed={active}
                className={cn(
                  "group flex items-start gap-2 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
                  active
                    ? "border-forest/50 bg-forest-tint"
                    : disabled
                      ? "cursor-not-allowed border-line bg-parchment/60 opacity-70"
                      : "border-line bg-canvas hover:border-forest/40 hover:bg-forest-tint/40",
                )}
              >
                <Play
                  size={13}
                  className={cn(
                    "mt-0.5 shrink-0",
                    active ? "text-forest" : "text-faint",
                  )}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-charcoal">
                    {scenario.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-faint">
                    {scenario.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
          {scenarioRunning
            ? "Running a scripted scenario. Transcript turns are tagged “scripted” and clearly separated from live microphone conversation."
            : "Scenarios are disabled during a live call so live and scripted interaction are never mixed."}
        </p>
      </div>
    </Card>
  );
}
