import { describe, expect, it } from "vitest";

import type { Intent } from "@/lib/domain/types";
import { analyzeSessions } from "@/lib/server/analytics";
import type {
  AgentSessionMetrics,
  KnowledgeEntry,
  StoredSession,
} from "@/lib/server/db/types";

function session(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    id: crypto.randomUUID(),
    userId: "u@example.com",
    userEmail: "u@example.com",
    locale: "en",
    mode: "text-fallback",
    intent: "ORDER_TRACKING",
    resolution: "RESOLVED",
    summary: "Tracked ORD-101.",
    turnCount: 2,
    unresolved: [],
    escalated: false,
    lastReply: null,
    agentMetrics: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function knowledge(intent: Intent | null, approved = true): KnowledgeEntry {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    question: "Q",
    answer: "A",
    intent,
    locale: "en",
    source: "admin",
    approved,
    usageCount: 0,
    createdBy: "admin@example.com",
    createdAt: now,
    updatedAt: now,
  };
}

describe("analyzeSessions", () => {
  it("returns zeros for an empty history", () => {
    const analytics = analyzeSessions([], []);
    expect(analytics.escalationRate).toBe(0);
    expect(analytics.unresolvedRate).toBe(0);
    expect(analytics.agent.turns).toBe(0);
    expect(analytics.topUnresolvedTopics).toEqual([]);
    expect(analytics.coverageGaps).toEqual([]);
  });

  it("computes escalation and unresolved rates from resolutions", () => {
    const sessions = [
      session({ resolution: "RESOLVED" }),
      session({ resolution: "UNRESOLVED" }),
      session({ resolution: "ESCALATION_REQUIRED" }),
      session({ resolution: "RESOLVED" }),
    ];
    const analytics = analyzeSessions(sessions, []);
    expect(analytics.escalationRate).toBeCloseTo(0.25);
    expect(analytics.unresolvedRate).toBeCloseTo(0.25);
  });

  it("ranks unresolved topics by intent and keeps real examples", () => {
    const sessions = [
      session({ resolution: "UNRESOLVED", intent: "RETURN_REQUEST", summary: "Return ORD-102 denied." }),
      session({ resolution: "UNRESOLVED", intent: "RETURN_REQUEST", summary: "Return ORD-102 again." }),
      session({ resolution: "ESCALATION_REQUIRED", intent: "DAMAGED_PRODUCT", summary: "Broken bottle." }),
      session({ resolution: "RESOLVED", intent: "RETURN_REQUEST", summary: "Returned fine." }),
    ];
    const analytics = analyzeSessions(sessions, []);
    expect(analytics.topUnresolvedTopics[0].label).toBe("RETURN_REQUEST");
    expect(analytics.topUnresolvedTopics[0].count).toBe(2);
    expect(analytics.topUnresolvedTopics[0].examples[0]).toContain("ORD-102");
    // Only non-RESOLVED sessions contribute to unresolved topics.
    expect(analytics.topUnresolvedTopics[0].count).toBe(2);
  });

  it("flags intents that customers raise with no approved answer", () => {
    const sessions = [
      session({ intent: "SHIPPING_QUERY" }),
      session({ intent: "SHIPPING_QUERY" }),
      session({ intent: "COD_QUERY" }),
      session({ intent: "ORDER_TRACKING" }),
    ];
    const analytics = analyzeSessions(sessions, [
      knowledge("ORDER_TRACKING"),
      knowledge("SHIPPING_QUERY", false),
    ]);
    const gaps = analytics.coverageGaps.map((gap) => gap.intent);
    expect(gaps).toContain("SHIPPING_QUERY");
    expect(gaps).toContain("COD_QUERY");
    expect(gaps).not.toContain("ORDER_TRACKING");
    expect(analytics.coverageGaps[0].intent).toBe("SHIPPING_QUERY");
    expect(analytics.coverageGaps[0].sessions).toBe(2);
  });

  it("aggregates agent metrics into assist and draft rates", () => {
    const metrics: AgentSessionMetrics = {
      turns: 6,
      aiTurns: 3,
      acceptedDrafts: 2,
      rejectedDrafts: 1,
    };
    const analytics = analyzeSessions(
      [session({ agentMetrics: metrics }), session({ agentMetrics: metrics })],
      [],
    );
    expect(analytics.agent.turns).toBe(12);
    expect(analytics.agent.aiTurns).toBe(6);
    expect(analytics.agent.aiAssistRate).toBeCloseTo(0.5);
    expect(analytics.agent.draftAcceptRate).toBeCloseTo(2 / 3);
  });
});
