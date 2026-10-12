import { describe, expect, it } from "vitest";
import {
  buildOutcome,
  callOutcomeSchema,
  validateOutcome,
  type OutcomeDraft,
} from "../outcome";
import {
  appendTurn,
  filterTranscript,
  formatTranscriptText,
  sortChronologically,
  validateTranscriptIntegrity,
  type TranscriptTurn,
} from "../transcript";

const validDraft: OutcomeDraft = {
  intent: "ORDER_TRACKING",
  orderId: "ORD-101",
  resolution: "RESOLVED",
  summary: "Customer asked about ORD-101.",
  actions: [],
  unresolved: [],
  mode: "browser-voice",
};

describe("outcome schema", () => {
  it("accepts a valid outcome", () => {
    const outcome = buildOutcome(validDraft, () => new Date("2026-01-01T00:00:00Z"));
    expect(validateOutcome(outcome).ok).toBe(true);
  });

  it("rejects an invalid intent", () => {
    const result = validateOutcome({
      customer_intent: "NOT_AN_INTENT",
      order_id: null,
      resolution_status: "RESOLVED",
      call_summary: "x",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid resolution status", () => {
    expect(
      callOutcomeSchema.safeParse({
        customer_intent: "UNKNOWN",
        order_id: null,
        resolution_status: "DONE",
        call_summary: "x",
        actions_executed: [],
        unresolved_issues: [],
        generated_at: "2026-01-01T00:00:00Z",
        mode: "text-fallback",
      }).success,
    ).toBe(false);
  });

  it("allows a null order id", () => {
    const outcome = buildOutcome({ ...validDraft, orderId: null });
    expect(outcome.order_id).toBeNull();
  });

  it("falls back to an honest outcome instead of emitting invalid data", () => {
    const bad = buildOutcome({
      ...validDraft,
      intent: "NOT_REAL" as OutcomeDraft["intent"],
    });
    expect(bad.customer_intent).toBe("UNKNOWN");
    expect(bad.resolution_status).toBe("UNRESOLVED");
    expect(bad.call_summary.toLowerCase()).toContain("could not be validated");
  });
});

describe("transcript", () => {
  const turns: TranscriptTurn[] = [
    { id: "1", speaker: "agent", text: "Hello", at: "2026-01-01T10:00:00Z" },
    { id: "2", speaker: "customer", text: "Track ORD-101", at: "2026-01-01T10:00:05Z" },
    { id: "3", speaker: "agent", text: "It is out for delivery", at: "2026-01-01T10:00:08Z" },
  ];

  it("appends turns with generated ids", () => {
    const next = appendTurn([], { speaker: "customer", text: "hi", at: "2026-01-01T10:00:00Z" });
    expect(next).toHaveLength(1);
    expect(next[0].id).toBeTruthy();
  });

  it("sorts chronologically", () => {
    const shuffled = [turns[2], turns[0], turns[1]];
    expect(sortChronologically(shuffled).map((t) => t.id)).toEqual(["1", "2", "3"]);
  });

  it("filters by speaker", () => {
    expect(filterTranscript(turns, { speaker: "agent" })).toHaveLength(2);
  });

  it("filters by query, case-insensitively", () => {
    expect(filterTranscript(turns, { query: "ord-101" })).toHaveLength(1);
  });

  it("combines filters", () => {
    expect(filterTranscript(turns, { speaker: "agent", query: "delivery" })).toHaveLength(1);
  });

  it("formats a transcript with labels", () => {
    const text = formatTranscriptText(turns);
    expect(text).toContain("Aria (Aura Voice CX)");
    expect(text).toContain("Customer");
  });

  it("reports missing information rather than fabricating a transcript", () => {
    const text = formatTranscriptText([]);
    expect(text.toLowerCase()).toContain("no conversation turns");

    const integrity = validateTranscriptIntegrity([]);
    expect(integrity.ok).toBe(false);
    expect(integrity.missing.length).toBeGreaterThan(0);
  });

  it("validates transcript integrity", () => {
    expect(validateTranscriptIntegrity(turns).ok).toBe(true);
    expect(
      validateTranscriptIntegrity([turns[0]]).missing.join(" ").toLowerCase(),
    ).toContain("customer");
  });
});
