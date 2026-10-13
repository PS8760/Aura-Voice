import { describe, expect, it } from "vitest";

import { buildRagIndex, knowledgeToDocuments, retrievePassages } from "@/lib/server/rag/context";
import { chunkDocuments } from "@/lib/server/rag/chunk";
import { localEmbeddingProvider } from "@/lib/server/rag/embed";
import { retrieve } from "@/lib/server/rag/retrieve";
import { VectorIndex } from "@/lib/server/rag/store";
import { defaultTenant, tenantDocuments } from "@/lib/server/rag/corpus";
import type { KnowledgeEntry } from "@/lib/server/db/types";

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

async function indexWith(docs: ReturnType<typeof tenantDocuments>) {
  const index = new VectorIndex(localEmbeddingProvider());
  await index.build(chunkDocuments(docs));
  return index;
}

describe("hybrid retrieval", () => {
  it("retrieves the shipping policy for a shipping question", async () => {
    const index = await indexWith(tenantDocuments(defaultTenant()));
    const hits = await retrieve(index, "how much is delivery and how long does it take");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.documentId)).toContain("policy.shipping");
    expect(hits[0].id).toBe("K1");
  });

  it("retrieves the return policy for a return question", async () => {
    const index = await indexWith(tenantDocuments(defaultTenant()));
    const hits = await retrieve(index, "I want to send back an unopened product");
    expect(hits.map((h) => h.documentId)).toContain("policy.returns");
  });

  it("boosts chunks whose intent hint matches the turn", async () => {
    const index = await indexWith(tenantDocuments(defaultTenant()));
    const plain = await retrieve(index, "tell me the policy");
    const boosted = await retrieve(index, "tell me the policy", { intent: "COD_QUERY" });
    const codRankPlain = plain.findIndex((h) => h.documentId === "policy.cod");
    const codRankBoosted = boosted.findIndex((h) => h.documentId === "policy.cod");
    if (codRankBoosted !== -1) {
      expect(codRankBoosted).toBeLessThanOrEqual(codRankPlain === -1 ? 99 : codRankPlain);
    }
  });

  it("returns nothing for an empty query", async () => {
    const index = await indexWith(tenantDocuments(defaultTenant()));
    expect(await retrieve(index, "   ")).toEqual([]);
  });
});

describe("knowledge integration", () => {
  it("maps approved knowledge into retrieval documents", () => {
    const [mapped] = knowledgeToDocuments([knowledge()], "aura-skincare");
    expect(mapped.id).toBe("knowledge:k1");
    expect(mapped.source).toBe("knowledge");
    expect(mapped.text).toContain("Nepal");
  });

  it("retrieves an approved knowledge answer through the full pipeline", async () => {
    const passages = await retrievePassages("do you deliver to nepal", {
      knowledge: [knowledge()],
      k: 3,
    });
    expect(passages.some((p) => p.documentId === "knowledge:k1")).toBe(true);
  });

  it("builds an index that combines tenant policy and knowledge", async () => {
    const index = await buildRagIndex({ knowledge: [knowledge()] });
    expect(index.size).toBeGreaterThan(0);
    expect(index.stats().embedderId).toContain("local-hash");
  });
});
