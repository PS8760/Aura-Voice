import { describe, expect, it } from "vitest";
import { createInMemoryOrderRepository } from "../orders";
import {
  ConversationOrchestrator,
  initialSessionState,
} from "../orchestrator";

function makeOrchestrator() {
  const repo = createInMemoryOrderRepository();
  const fixed = new Date("2026-01-01T10:00:00.000Z");
  return { repo, orchestrator: new ConversationOrchestrator(repo, () => fixed) };
}

describe("greeting", () => {
  it("introduces Aria and the supported topics", () => {
    const { orchestrator } = makeOrchestrator();
    const greeting = orchestrator.greeting();
    expect(greeting).toContain("Aria");
    expect(greeting.toLowerCase()).toContain("aura");
  });
});

describe("order tracking", () => {
  it("tracks ORD-101 with courier and tracking reference", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn("Where is my order ORD-101?", initialSessionState());
    expect(result.intent).toBe("ORDER_TRACKING");
    expect(result.orderId).toBe("ORD-101");
    expect(result.resolution).toBe("RESOLVED");
    expect(result.reply).toContain("BlueDart");
    expect(result.reply).toContain("BD-982103");
    expect(result.reply.toLowerCase()).toContain("mock data");
  });

  it("tracks ORD-103 and explicitly reports the missing courier data", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn("track ORD-103", initialSessionState());
    expect(result.resolution).toBe("RESOLVED");
    expect(result.reply.toLowerCase()).toContain("no courier");
    expect(result.unresolved.join(" ").toLowerCase()).toContain("no courier or tracking data");
  });

  it("asks the customer to verify an unknown order id", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn("track ORD-999", initialSessionState());
    expect(result.resolution).toBe("UNRESOLVED");
    expect(result.pending).toBe("verify_order_id");
    expect(result.reply.toLowerCase()).toContain("could not find");
  });

  it("asks for an order id when none is supplied", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn("where is my order", initialSessionState());
    expect(result.pending).toBe("order_id");
    expect(result.resolution).toBe("UNRESOLVED");
  });

  it("carries the order id across follow-up turns", () => {
    const { orchestrator } = makeOrchestrator();
    const first = orchestrator.processTurn("track ORD-101", initialSessionState());
    const second = orchestrator.processTurn("when will it arrive?", first.state);
    expect(second.orderId).toBe("ORD-101");
  });
});

describe("cancellation", () => {
  it("cancels ORD-103 while it is Processing", () => {
    const { orchestrator, repo } = makeOrchestrator();
    const result = orchestrator.processTurn("cancel ORD-103", initialSessionState());
    expect(result.intent).toBe("CANCELLATION_REQUEST");
    expect(result.resolution).toBe("RESOLVED");
    expect(result.executed).toBe(true);
    expect(repo.getById("ORD-103")?.status).toBe("Cancelled");
  });

  it("refuses cancellation for an out-for-delivery order and explains the rule", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn("cancel ORD-101", initialSessionState());
    expect(result.resolution).toBe("UNRESOLVED");
    expect(result.executed).toBe(false);
    expect(result.policyExplanation?.toLowerCase()).toContain("processing");
    expect(result.reply.toLowerCase()).toContain("refuse");
  });

  it("ignores a duplicate cancellation in the same session", () => {
    const { orchestrator } = makeOrchestrator();
    const first = orchestrator.processTurn("cancel ORD-103", initialSessionState());
    const second = orchestrator.processTurn("cancel ORD-103 again", first.state);
    expect(second.executed).toBe(false);
    expect(second.reply.toLowerCase()).toContain("already been cancelled");
  });

  it("asks for an order id when cancelling without one", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn("I want to cancel my order", initialSessionState());
    expect(result.pending).toBe("order_id");
  });
});

describe("returns", () => {
  it("denies a return for ORD-102 delivered 14 days ago", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn("I want to return ORD-102", initialSessionState());
    expect(result.intent).toBe("RETURN_REQUEST");
    expect(result.resolution).toBe("UNRESOLVED");
    expect(result.policyExplanation?.toLowerCase()).toContain("7 days");
  });
});

describe("shipping, COD and damaged products", () => {
  it("explains the exactly-₹499 boundary in a general shipping query", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn("how much is delivery?", initialSessionState());
    expect(result.reply).toContain("₹499");
    expect(result.reply.toLowerCase()).toContain("does not specify");
  });

  it("answers a general COD query", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn("do you offer cash on delivery?", initialSessionState());
    expect(result.reply).toContain("2,500");
  });

  it("denies a damaged-product claim past the 48-hour window", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn(
      "my ORD-102 product arrived damaged",
      initialSessionState(),
    );
    expect(result.intent).toBe("DAMAGED_PRODUCT");
    expect(result.resolution).toBe("UNRESOLVED");
    expect(result.policyExplanation?.toLowerCase()).toContain("48 hours");
  });
});

describe("clarification and scope", () => {
  it("asks a clarifying question for an ambiguous order request", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn("Can you help me with my order?", initialSessionState());
    expect(result.pending).toBe("order_action");
    expect(result.reply.toLowerCase()).toContain("track");
  });

  it("politely declines out-of-scope requests", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn("what's the weather in Mumbai?", initialSessionState());
    expect(result.intent).toBe("OUT_OF_SCOPE");
    expect(result.resolution).toBe("OUT_OF_SCOPE");
  });

  it("does not invent product catalogue details", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn(
      "what are the ingredients in your vitamin c serum?",
      initialSessionState(),
    );
    expect(result.resolution).toBe("ESCALATION_REQUIRED");
    expect(result.unresolved.join(" ").toLowerCase()).toContain("catalogue");
  });
});

describe("outcome", () => {
  it("builds a valid outcome after an interaction", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn("track ORD-101", initialSessionState());
    const outcome = orchestrator.buildOutcome(result.state, "browser-voice");
    expect(outcome.customer_intent).toBe("ORDER_TRACKING");
    expect(outcome.order_id).toBe("ORD-101");
    expect(outcome.resolution_status).toBe("RESOLVED");
    expect(outcome.call_summary.length).toBeGreaterThan(0);
  });

  it("uses null order id when none was supplied", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn("what's the weather", initialSessionState());
    const outcome = orchestrator.buildOutcome(result.state, "text-fallback");
    expect(outcome.order_id).toBeNull();
    expect(outcome.resolution_status).toBe("OUT_OF_SCOPE");
  });
});

describe("activity events", () => {
  it("emits honest, ordered events for a tracking turn", () => {
    const { orchestrator } = makeOrchestrator();
    const result = orchestrator.processTurn("track ORD-101", initialSessionState());
    const types = result.events.map((e) => e.type);
    expect(types).toContain("intent_detected");
    expect(types).toContain("order_identified");
    expect(types).toContain("order_service_queried");
    expect(types).toContain("result_returned");
    expect(types.indexOf("intent_detected")).toBeLessThan(types.indexOf("result_returned"));
  });
});
