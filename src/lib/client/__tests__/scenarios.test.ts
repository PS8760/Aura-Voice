import { describe, expect, it } from "vitest";

import { createInMemoryOrderRepository } from "@/lib/domain/orders";
import { ConversationOrchestrator } from "@/lib/domain/orchestrator";
import { validateOutcome } from "@/lib/domain/outcome";
import { SCENARIOS, findScenario, runScenario } from "../scenarios";

function makeEngine() {
  const repo = createInMemoryOrderRepository();
  const fixed = new Date("2026-01-01T10:00:00.000Z");
  return new ConversationOrchestrator(repo, () => fixed);
}

function run(id: string) {
  const scenario = findScenario(id);
  if (!scenario) throw new Error(`scenario ${id} missing`);
  return runScenario(makeEngine(), scenario);
}

describe("guided scenarios exercise the real engine", () => {
  it("defines the six assessment scenarios", () => {
    expect(SCENARIOS).toHaveLength(6);
  });

  it("produces at least one turn and a valid outcome for every scenario", () => {
    for (const scenario of SCENARIOS) {
      const { turns, outcome } = runScenario(makeEngine(), scenario);
      expect(turns.length).toBeGreaterThan(0);
      const validated = validateOutcome(outcome);
      expect(validated.ok).toBe(true);
      expect(outcome.mode).toBe("scenario");
    }
  });
});

describe("track ORD-101", () => {
  it("resolves with real courier data", () => {
    const { turns, outcome } = run("track-101");
    expect(turns[0].intent).toBe("ORDER_TRACKING");
    expect(outcome.order_id).toBe("ORD-101");
    expect(outcome.resolution_status).toBe("RESOLVED");
    expect(turns[0].reply).toContain("BlueDart");
  });
});

describe("cancel ORD-103", () => {
  it("executes the mock cancellation and never reports a failure as success", () => {
    const { outcome } = run("cancel-103");
    expect(outcome.resolution_status).toBe("RESOLVED");
    const cancellation = outcome.actions_executed.find(
      (action) => action.type === "CANCELLATION",
    );
    expect(cancellation?.status).toBe("executed");
    expect(cancellation?.orderId).toBe("ORD-103");
  });
});

describe("return ORD-102", () => {
  it("is denied because the order was delivered 14 days ago", () => {
    const { outcome } = run("return-102");
    expect(outcome.resolution_status).toBe("UNRESOLVED");
    const executedReturn = outcome.actions_executed.find(
      (action) => action.type === "RETURN_REQUEST" && action.status === "executed",
    );
    expect(executedReturn).toBeUndefined();
  });
});

describe("nonexistent order", () => {
  it("does not invent data for ORD-999", () => {
    const { turns, outcome } = run("unknown-order");
    expect(outcome.resolution_status).toBe("UNRESOLVED");
    expect(turns[0].reply.toLowerCase()).toContain("could not find");
    expect(turns[0].reply).not.toContain("BlueDart");
  });
});

describe("unrelated question", () => {
  it("politely declines with OUT_OF_SCOPE", () => {
    const { outcome } = run("unrelated");
    expect(outcome.customer_intent).toBe("OUT_OF_SCOPE");
    expect(outcome.resolution_status).toBe("OUT_OF_SCOPE");
  });
});

describe("ambiguous order question", () => {
  it("asks a clarifying question instead of guessing", () => {
    const { turns, outcome } = run("ambiguous");
    expect(outcome.customer_intent).toBe("UNKNOWN");
    expect(outcome.resolution_status).toBe("UNRESOLVED");
    expect(outcome.actions_executed).toHaveLength(0);
    expect(turns[0].reply.toLowerCase()).toContain("track");
  });
});
