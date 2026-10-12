import { describe, expect, it } from "vitest";

import type { ExecutedAction } from "@/lib/domain/outcome";
import { initialSessionState } from "@/lib/domain/orchestrator";
import { createEngine, createRequestRepository } from "../engine";

function executedCancellation(orderId: string): ExecutedAction {
  return {
    id: "act_test",
    type: "CANCELLATION",
    orderId,
    status: "executed",
    detail: "Order cancelled while in Processing.",
    at: "2026-01-01T10:00:00.000Z",
  };
}

describe("stateless request repository", () => {
  it("starts from pristine fixtures when no actions are replayed", () => {
    const repo = createRequestRepository([]);
    expect(repo.getById("ORD-103")?.status).toBe("Processing");
  });

  it("replays an executed cancellation onto a fresh fixture copy", () => {
    const repo = createRequestRepository([executedCancellation("ORD-103")]);
    expect(repo.getById("ORD-103")?.status).toBe("Cancelled");
  });

  it("does not leak mutations to unrelated orders", () => {
    const repo = createRequestRepository([executedCancellation("ORD-103")]);
    expect(repo.getById("ORD-101")?.status).toBe("Out for Delivery");
    expect(repo.getById("ORD-102")?.status).toBe("Delivered");
  });

  it("ignores blocked (non-executed) actions", () => {
    const blocked: ExecutedAction = {
      ...executedCancellation("ORD-103"),
      status: "blocked",
    };
    const repo = createRequestRepository([blocked]);
    expect(repo.getById("ORD-103")?.status).toBe("Processing");
  });
});

describe("engine over a request repository", () => {
  it("reports an already-cancelled order as complete rather than re-cancelling", () => {
    const repo = createRequestRepository([executedCancellation("ORD-103")]);
    const engine = createEngine(repo);
    const state = {
      ...initialSessionState(),
      actions: [executedCancellation("ORD-103")],
    };
    const result = engine.processTurn("cancel ORD-103", state);
    expect(result.reply.toLowerCase()).toContain("already");
    expect(result.executed).toBe(false);
    // No second cancellation attempt should be recorded.
    const cancellations = result.state.actions.filter(
      (action) => action.type === "CANCELLATION",
    );
    expect(cancellations).toHaveLength(1);
  });

  it("cancels a Processing order on a fresh request repository", () => {
    const engine = createEngine(createRequestRepository([]));
    const result = engine.processTurn(
      "please cancel ORD-103",
      initialSessionState(),
    );
    expect(result.executed).toBe(true);
    expect(result.resolution).toBe("RESOLVED");
  });
});
