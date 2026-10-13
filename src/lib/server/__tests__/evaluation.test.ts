import { describe, expect, it } from "vitest";

import { SCENARIOS } from "@/lib/client/scenarios";
import { evaluateScenario, runEvaluation } from "@/lib/server/evaluation";

describe("agent evaluation harness", () => {
  it("evaluates every scenario and passes all of them", () => {
    const results = runEvaluation();
    expect(results).toHaveLength(SCENARIOS.length);
    for (const result of results) {
      expect(result.checks.length).toBeGreaterThan(0);
      expect(result.passed).toBe(true);
    }
  });

  it("reports the individual checks for a known scenario", () => {
    const scenario = SCENARIOS.find((entry) => entry.id === "track-101");
    if (!scenario) throw new Error("track-101 missing");
    const result = evaluateScenario(scenario);
    expect(result.passed).toBe(true);
    const labels = result.checks.map((check) => check.label);
    expect(labels).toContain("reply names the real courier (BlueDart)");
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it("is deterministic across runs (fixed clock, fresh store)", () => {
    const first = runEvaluation().map((result) => result.passed);
    const second = runEvaluation().map((result) => result.passed);
    expect(first).toEqual(second);
  });
});
