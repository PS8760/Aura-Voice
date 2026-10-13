import { createInMemoryOrderRepository } from "@/lib/domain/orders";
import { ConversationOrchestrator } from "@/lib/domain/orchestrator";
import { validateOutcome } from "@/lib/domain/outcome";
import {
  SCENARIOS,
  runScenario,
  type Scenario,
  type ScenarioRun,
} from "@/lib/client/scenarios";

/**
 * Agent evaluation harness.
 *
 * Replays the six assessment scenarios through the *real* deterministic engine
 * against a fresh, fixed-clock repository, then checks explicit expectations —
 * the same guarantees the unit tests assert, but surfaced in the admin portal
 * so a reviewer can see the agent pass or fail on demand.
 *
 * Nothing is simulated: `runScenario` drives the production orchestrator. The
 * clock is pinned so results are reproducible across runs.
 */

export interface EvalCheck {
  label: string;
  passed: boolean;
}

export interface EvalResult {
  id: string;
  label: string;
  description: string;
  expect: string;
  passed: boolean;
  checks: EvalCheck[];
}

const EVAL_CLOCK = () => new Date("2026-01-01T10:00:00.000Z");

type Check = (run: ScenarioRun) => EvalCheck;

function check(label: string, passed: boolean): EvalCheck {
  return { label, passed };
}

function executedAction(run: ScenarioRun, type: string): boolean {
  return run.outcome.actions_executed.some((action) => action.type === type && action.status === "executed");
}

const EXPECTATIONS: Record<string, Check[]> = {
  "track-101": [
    (run) => check("intent is ORDER_TRACKING", run.turns[0]?.intent === "ORDER_TRACKING"),
    (run) => check("order id resolved to ORD-101", run.outcome.order_id === "ORD-101"),
    (run) => check("resolution is RESOLVED", run.outcome.resolution_status === "RESOLVED"),
    (run) => check("reply names the real courier (BlueDart)", run.turns[0]?.reply.includes("BlueDart") ?? false),
  ],
  "cancel-103": [
    (run) => check("resolution is RESOLVED", run.outcome.resolution_status === "RESOLVED"),
    (run) => check("cancellation executed for ORD-103", executedAction(run, "CANCELLATION") && run.outcome.order_id === "ORD-103"),
  ],
  "return-102": [
    (run) => check("resolution is UNRESOLVED", run.outcome.resolution_status === "UNRESOLVED"),
    (run) => check("no return was wrongly executed", !executedAction(run, "RETURN_REQUEST")),
  ],
  "unknown-order": [
    (run) => check("resolution is UNRESOLVED", run.outcome.resolution_status === "UNRESOLVED"),
    (run) => check("reply admits it could not find the order", (run.turns[0]?.reply.toLowerCase().includes("could not find") ?? false)),
    (run) => check("reply invents no courier", !(run.turns[0]?.reply.includes("BlueDart") ?? false)),
  ],
  unrelated: [
    (run) => check("intent is OUT_OF_SCOPE", run.outcome.customer_intent === "OUT_OF_SCOPE"),
    (run) => check("resolution is OUT_OF_SCOPE", run.outcome.resolution_status === "OUT_OF_SCOPE"),
  ],
  ambiguous: [
    (run) => check("intent stays UNKNOWN", run.outcome.customer_intent === "UNKNOWN"),
    (run) => check("resolution is UNRESOLVED", run.outcome.resolution_status === "UNRESOLVED"),
    (run) => check("no action was guessed", run.outcome.actions_executed.length === 0),
    (run) => check("reply offers the track/cancel/return choice", (run.turns[0]?.reply.toLowerCase().includes("track") ?? false)),
  ],
};

function baseChecks(run: ScenarioRun): EvalCheck[] {
  return [
    check("produced at least one turn", run.turns.length > 0),
    check("outcome passes schema validation", validateOutcome(run.outcome).ok),
    check("outcome is marked as a scenario run", run.outcome.mode === "scenario"),
  ];
}

export function evaluateScenario(scenario: Scenario): EvalResult {
  const engine = new ConversationOrchestrator(createInMemoryOrderRepository(), EVAL_CLOCK);
  const run = runScenario(engine, scenario);
  const checks = [
    ...baseChecks(run),
    ...(EXPECTATIONS[scenario.id] ?? []).map((expectation) => expectation(run)),
  ];
  return {
    id: scenario.id,
    label: scenario.label,
    description: scenario.description,
    expect: scenario.expect,
    passed: checks.every((entry) => entry.passed),
    checks,
  };
}

export function runEvaluation(): EvalResult[] {
  return SCENARIOS.map(evaluateScenario);
}
