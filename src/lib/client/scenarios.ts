import type {
  ActivityEvent,
  ConversationOrchestrator,
  SessionState,
} from "@/lib/domain/orchestrator";
import type { CallOutcome } from "@/lib/domain/outcome";
import { initialSessionState } from "@/lib/domain/orchestrator";
import type { Intent, ResolutionStatus } from "@/lib/domain/types";

/**
 * Guided scenarios.
 *
 * Each scenario is a small script of real customer utterances. They are fed
 * through the *actual* deterministic engine (or the server route), so the
 * result is genuine and inspectable — this is never a canned response. The UI
 * labels scripted playback separately from a live microphone conversation.
 */
export interface Scenario {
  id: string;
  label: string;
  description: string;
  utterances: string[];
  /** Short note shown under the scenario once it completes. */
  expect: string;
}

export const SCENARIOS: readonly Scenario[] = Object.freeze([
  {
    id: "track-101",
    label: "Track ORD-101",
    description: "Ask where a shipped order is.",
    utterances: ["Hi, where is my order ORD-101?"],
    expect: "Expect tracking details returned from mock data.",
  },
  {
    id: "cancel-103",
    label: "Cancel ORD-103",
    description: "Cancel an order that is still Processing.",
    utterances: ["Please cancel order ORD-103."],
    expect: "Expect the mock cancellation to execute.",
  },
  {
    id: "return-102",
    label: "Return ORD-102",
    description: "Request a return for a delivered order.",
    utterances: ["I would like to return ORD-102."],
    expect: "Expect a policy denial: delivered 14 days ago.",
  },
  {
    id: "unknown-order",
    label: "Look up a nonexistent order",
    description: "Reference an id that is not in the dataset.",
    utterances: ["Can you track order ORD-999 for me?"],
    expect: "Expect an honest not-found reply, no invented data.",
  },
  {
    id: "unrelated",
    label: "Ask an unrelated question",
    description: "Try to take Aria off-topic.",
    utterances: ["What is the weather in Mumbai tomorrow?"],
    expect: "Expect a polite out-of-scope decline.",
  },
  {
    id: "ambiguous",
    label: "Ask an ambiguous order question",
    description: "Mention an order without saying what you need.",
    utterances: ["Can you help me with my order?"],
    expect: "Expect a clarifying question: track, cancel or return.",
  },
] as const satisfies readonly Scenario[]);

export interface ScenarioStep {
  customer: string;
  reply: string;
  intent: Intent;
  orderId: string | null;
  resolution: ResolutionStatus;
  events: ActivityEvent[];
  state: SessionState;
}

export interface ScenarioRun {
  turns: ScenarioStep[];
  outcome: CallOutcome;
}

/**
 * Run a scenario synchronously against a deterministic engine. Used by tests
 * and as an offline result preview; the live UI drives the same engine one
 * turn at a time through the shared client transport.
 */
export function runScenario(
  engine: ConversationOrchestrator,
  scenario: Scenario,
): ScenarioRun {
  let state = initialSessionState();
  const turns: ScenarioStep[] = [];

  for (const utterance of scenario.utterances) {
    const result = engine.processTurn(utterance, state);
    state = result.state;
    turns.push({
      customer: utterance,
      reply: result.reply,
      intent: result.intent,
      orderId: result.orderId,
      resolution: result.resolution,
      events: result.events,
      state: result.state,
    });
  }

  return { turns, outcome: engine.buildOutcome(state, "scenario") };
}

export function findScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}
