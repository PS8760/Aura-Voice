import { describe, expect, it } from "vitest";
import { createInMemoryOrderRepository } from "../orders";
import { ToolExecutor } from "../tools";

function makeExecutor() {
  const repo = createInMemoryOrderRepository();
  const fixed = new Date("2026-01-01T10:00:00.000Z");
  return { repo, executor: new ToolExecutor(repo, () => fixed) };
}

describe("ToolExecutor", () => {
  it("looks up a known order", () => {
    const { executor } = makeExecutor();
    const { result, call } = executor.lookupOrder("ORD-101");
    expect(result.ok).toBe(true);
    expect(result.data?.status).toBe("Out for Delivery");
    expect(call.ok).toBe(true);
    expect(call.at).toBe("2026-01-01T10:00:00.000Z");
  });

  it("fails gracefully when the order id is missing", () => {
    const { executor } = makeExecutor();
    const { result } = executor.lookupOrder(undefined);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ORDER_ID_REQUIRED");
  });

  it("fails gracefully for an unknown order", () => {
    const { executor } = makeExecutor();
    const { result, call } = executor.lookupOrder("ORD-999");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ORDER_NOT_FOUND");
    expect(call.summary).toContain("not found");
  });

  it("rejects malformed shipping input", () => {
    const { executor } = makeExecutor();
    const { result } = executor.checkShipping("not-a-number");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
  });

  it("checks shipping for a numeric value", () => {
    const { executor } = makeExecutor();
    const { result } = executor.checkShipping(499);
    expect(result.ok).toBe(true);
    expect(result.data?.status).toBe("boundary");
  });

  it("blocks a cancellation check when the order is unknown", () => {
    const { executor } = makeExecutor();
    const { result } = executor.checkCancellation("ORD-999");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ORDER_NOT_FOUND");
  });

  it("evaluates cancellation for a processing order", () => {
    const { executor } = makeExecutor();
    const { result } = executor.checkCancellation("ORD-103");
    expect(result.ok).toBe(true);
    expect(result.data?.status).toBe("allowed");
  });

  it("does not throw when the repository errors", () => {
    const repo = createInMemoryOrderRepository();
    repo.getById = () => {
      throw new Error("boom");
    };
    const executor = new ToolExecutor(repo);
    const { result } = executor.lookupOrder("ORD-101");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("REPOSITORY_ERROR");
  });

  it("produces unique tool call ids", () => {
    const { executor } = makeExecutor();
    const a = executor.lookupOrder("ORD-101").call.id;
    const b = executor.lookupOrder("ORD-101").call.id;
    expect(a).not.toBe(b);
  });
});
