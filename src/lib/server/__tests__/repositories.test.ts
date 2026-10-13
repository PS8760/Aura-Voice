import { beforeEach, describe, expect, it } from "vitest";

import type { CallOutcome } from "@/lib/domain/outcome";
import {
  getRepositories,
  memoryRepositories,
  resetMemoryStore,
  sessionFromOutcome,
  statsFromSessions,
} from "@/lib/server/db/repositories";

function outcome(overrides: Partial<CallOutcome> = {}): CallOutcome {
  return {
    customer_intent: "ORDER_TRACKING",
    order_id: "ORD-101",
    resolution_status: "RESOLVED",
    call_summary: "Customer tracked ORD-101 and was told it is out for delivery.",
    actions_executed: [],
    unresolved_issues: [],
    generated_at: new Date().toISOString(),
    mode: "text-fallback",
    ...overrides,
  };
}

const meta = {
  userId: "priya@example.com",
  userEmail: "priya@example.com",
  locale: "en" as const,
  turnCount: 3,
};

beforeEach(() => {
  resetMemoryStore();
});

describe("repository backend selection", () => {
  it("falls back to the in-memory backend when no Mongo URI is configured", async () => {
    const repo = await getRepositories();
    expect(repo.backend).toBe("memory");
  });
});

describe("profile + address repository", () => {
  it("creates a profile on first upsert and fills a fallback name", async () => {
    const repo = memoryRepositories();
    const profile = await repo.profiles.upsert("rahul.verma@example.com", {
      email: "rahul.verma@example.com",
    });
    expect(profile.name).toBe("rahul verma");
    expect(profile.preferredLocale).toBe("en");
    expect(profile.addresses).toEqual([]);
  });

  it("persists profile fields across reads", async () => {
    const repo = memoryRepositories();
    await repo.profiles.upsert("a@example.com", { email: "a@example.com", name: "A" });
    await repo.profiles.upsert("a@example.com", { phone: "999", preferredLocale: "hi" });
    const read = await repo.profiles.get("a@example.com");
    expect(read?.name).toBe("A");
    expect(read?.phone).toBe("999");
    expect(read?.preferredLocale).toBe("hi");
  });

  it("makes the first address the default and keeps defaults unique", async () => {
    const repo = memoryRepositories();
    const base = {
      label: "Home",
      line1: "1 Aura Road",
      line2: "",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411001",
      phone: "",
    };
    const first = await repo.profiles.addAddress("a@example.com", { ...base, isDefault: false });
    expect(first.isDefault).toBe(true);

    const second = await repo.profiles.addAddress("a@example.com", {
      ...base,
      label: "Work",
      isDefault: true,
    });
    const addresses = await repo.profiles.listAddresses("a@example.com");
    expect(addresses).toHaveLength(2);
    expect(addresses.find((a) => a.id === first.id)?.isDefault).toBe(false);
    expect(addresses.find((a) => a.id === second.id)?.isDefault).toBe(true);
  });

  it("updates and removes addresses, promoting a new default on removal", async () => {
    const repo = memoryRepositories();
    const base = {
      label: "Home",
      line1: "1 Aura Road",
      line2: "",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411001",
      phone: "",
      isDefault: false,
    };
    const first = await repo.profiles.addAddress("a@example.com", base);
    const second = await repo.profiles.addAddress("a@example.com", { ...base, label: "Work" });

    const updated = await repo.profiles.updateAddress("a@example.com", second.id, {
      city: "Mumbai",
    });
    expect(updated?.city).toBe("Mumbai");

    expect(await repo.profiles.removeAddress("a@example.com", first.id)).toBe(true);
    const remaining = await repo.profiles.listAddresses("a@example.com");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].isDefault).toBe(true);
  });
});

describe("session repository", () => {
  it("stores sessions and derives stats", async () => {
    const repo = memoryRepositories();
    await repo.sessions.save(sessionFromOutcome(outcome(), meta));
    await repo.sessions.save(
      sessionFromOutcome(
        outcome({
          customer_intent: "GENERAL_PRODUCT_QUERY",
          resolution_status: "ESCALATION_REQUIRED",
          call_summary: "Customer asked about a discontinued product.",
        }),
        { ...meta, userId: "other@example.com", userEmail: "other@example.com" },
      ),
    );

    const all = await repo.sessions.listAll();
    expect(all).toHaveLength(2);

    const stats = await repo.sessions.stats();
    expect(stats.total).toBe(2);
    expect(stats.resolved).toBe(1);
    expect(stats.escalated).toBe(1);
    expect(stats.resolutionRate).toBeCloseTo(0.5);
  });

  it("filters sessions by user", async () => {
    const repo = memoryRepositories();
    await repo.sessions.save(sessionFromOutcome(outcome(), meta));
    await repo.sessions.save(
      sessionFromOutcome(outcome(), { ...meta, userId: "other@example.com", userEmail: "o@example.com" }),
    );
    const mine = await repo.sessions.listByUser("priya@example.com");
    expect(mine).toHaveLength(1);
    expect(mine[0].userEmail).toBe("priya@example.com");
  });

  it("maps outcome fields onto the stored session", async () => {
    const stored = sessionFromOutcome(
      outcome({ unresolved_issues: ["Needs a human"], resolution_status: "UNRESOLVED" }),
      meta,
    );
    expect(stored.intent).toBe("ORDER_TRACKING");
    expect(stored.resolution).toBe("UNRESOLVED");
    expect(stored.unresolved).toEqual(["Needs a human"]);
    expect(stored.escalated).toBe(false);
    expect(stored.turnCount).toBe(3);
  });

  it("persists the last reply and agent metrics when the client supplies them", async () => {
    const stored = sessionFromOutcome(outcome(), {
      ...meta,
      lastReply: "ORD-101 is out for delivery via BlueDart.",
      agentMetrics: { turns: 4, aiTurns: 2, acceptedDrafts: 1, rejectedDrafts: 1 },
    });
    expect(stored.lastReply).toBe("ORD-101 is out for delivery via BlueDart.");
    expect(stored.agentMetrics).toEqual({
      turns: 4,
      aiTurns: 2,
      acceptedDrafts: 1,
      rejectedDrafts: 1,
    });
  });

  it("defaults last reply and agent metrics to null when absent", () => {
    const stored = sessionFromOutcome(outcome(), meta);
    expect(stored.lastReply).toBeNull();
    expect(stored.agentMetrics).toBeNull();
  });
});

describe("statsFromSessions", () => {
  it("reports a zero rate with no sessions", () => {
    const stats = statsFromSessions([]);
    expect(stats.total).toBe(0);
    expect(stats.resolutionRate).toBe(0);
  });
});

describe("knowledge repository", () => {
  it("only returns approved entries from search", async () => {
    const repo = memoryRepositories();
    await repo.knowledge.create({
      question: "Do you ship sunscreen to Mumbai?",
      answer: "Yes, sunscreen ships pan-India within 3 to 5 days.",
      intent: "SHIPPING_QUERY",
      locale: "en",
      source: "admin",
      approved: true,
      createdBy: "admin@example.com",
    });
    await repo.knowledge.create({
      question: "Is there a sunscreen subscription?",
      answer: "",
      intent: null,
      locale: "en",
      source: "session",
      approved: false,
      createdBy: "system",
    });

    const hits = await repo.knowledge.search("sunscreen shipping");
    expect(hits).toHaveLength(1);
    expect(hits[0].approved).toBe(true);
  });

  it("approves, updates, increments usage and removes entries", async () => {
    const repo = memoryRepositories();
    const entry = await repo.knowledge.create({
      question: "Return window?",
      answer: "Returns are accepted within 7 days, unopened.",
      intent: "RETURN_REQUEST",
      locale: "en",
      source: "session",
      approved: false,
      createdBy: "system",
    });

    const approved = await repo.knowledge.approve(entry.id, true);
    expect(approved?.approved).toBe(true);

    const updated = await repo.knowledge.update(entry.id, { answer: "Seven days, unopened." });
    expect(updated?.answer).toBe("Seven days, unopened.");

    await repo.knowledge.incrementUsage(entry.id);
    await repo.knowledge.incrementUsage(entry.id);
    const [read] = await repo.knowledge.list();
    expect(read.usageCount).toBe(2);

    expect(await repo.knowledge.remove(entry.id)).toBe(true);
    expect(await repo.knowledge.list()).toHaveLength(0);
  });
});
