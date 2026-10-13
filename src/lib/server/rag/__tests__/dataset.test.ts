import { describe, expect, it } from "vitest";

import type { KnowledgeEntry, StoredSession } from "@/lib/server/db/types";
import {
  buildSftDataset,
  datasetStats,
  knowledgeToSample,
  sessionToSample,
  toJsonl,
} from "@/lib/server/rag/dataset";

function session(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    id: "s1",
    userId: "priya@example.com",
    userEmail: "priya@example.com",
    locale: "en",
    mode: "browser-voice",
    intent: "ORDER_TRACKING",
    resolution: "RESOLVED",
    summary: "Customer asked where ORD-101 is.",
    turnCount: 3,
    unresolved: [],
    escalated: false,
    lastReply: "ORD-101 is out for delivery with BlueDart. This is mock data.",
    agentMetrics: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function knowledge(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "k1",
    question: "Do you ship to Nepal?",
    answer: "Yes, international shipping to Nepal takes 10 to 14 days.",
    intent: "SHIPPING_QUERY",
    locale: "en",
    source: "admin",
    approved: true,
    usageCount: 0,
    createdBy: "admin@example.com",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("sessionToSample", () => {
  it("turns a resolved, in-scope session into a chat sample", () => {
    const sample = sessionToSample(session(), { brand: "Aura Skincare" });
    expect(sample).not.toBeNull();
    expect(sample?.messages).toHaveLength(3);
    expect(sample?.messages[0].content).toContain("Aura Skincare");
    expect(sample?.messages[2].content).toContain("BlueDart");
    expect(sample?.metadata.source).toBe("session");
  });

  it("skips unresolved sessions, empty replies and out-of-scope intents", () => {
    expect(sessionToSample(session({ resolution: "UNRESOLVED" }))).toBeNull();
    expect(sessionToSample(session({ lastReply: "  " }))).toBeNull();
    expect(sessionToSample(session({ intent: "OUT_OF_SCOPE" }))).toBeNull();
  });
});

describe("knowledgeToSample", () => {
  it("maps an approved entry to a pair", () => {
    const sample = knowledgeToSample(knowledge());
    expect(sample?.messages[1].content).toContain("Nepal");
    expect(sample?.metadata.knowledgeId).toBe("k1");
  });

  it("ignores unapproved entries", () => {
    expect(knowledgeToSample(knowledge({ approved: false }))).toBeNull();
  });
});

describe("buildSftDataset", () => {
  it("combines sessions and knowledge and reports stats", () => {
    const samples = buildSftDataset({
      sessions: [session(), session({ id: "s2", resolution: "ESCALATION_REQUIRED" })],
      knowledge: [knowledge(), knowledge({ id: "k2", approved: false })],
    });
    expect(samples).toHaveLength(2);

    const stats = datasetStats(samples);
    expect(stats.total).toBe(2);
    expect(stats.fromSessions).toBe(1);
    expect(stats.fromKnowledge).toBe(1);
    expect(stats.byIntent.ORDER_TRACKING).toBe(1);
    expect(stats.byLocale.en).toBe(2);
  });

  it("serialises to one JSON object per line with only messages", () => {
    const samples = buildSftDataset({ knowledge: [knowledge()] });
    const lines = toJsonl(samples).split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(Object.keys(parsed)).toEqual(["messages"]);
    expect(parsed.messages).toHaveLength(3);
  });
});
