import { describe, expect, it } from "vitest";

import { chunkDocument, chunkDocuments } from "@/lib/server/rag/chunk";
import { cosine, localEmbed, localEmbeddingProvider, tokenize } from "@/lib/server/rag/embed";
import type { RagDocument } from "@/lib/server/rag/types";

function doc(overrides: Partial<RagDocument> = {}): RagDocument {
  return {
    id: "doc-1",
    companyId: "acme",
    title: "Shipping",
    text: "Standard delivery takes 3 to 5 business days.",
    source: "policy",
    intent: null,
    locale: null,
    ...overrides,
  };
}

describe("tokenize", () => {
  it("keeps letters from non-latin scripts and drops punctuation", () => {
    expect(tokenize("Hello, दुनिया! ORD-101")).toContain("hello");
    expect(tokenize("Hello, दुनिया! ORD-101")).toContain("दुनिया");
    expect(tokenize("Hello, दुनिया! ORD-101")).not.toContain("ord-101");
    expect(tokenize("ORD-101")).toContain("ord");
    expect(tokenize("ORD-101")).toContain("101");
  });
});

describe("local embeddings", () => {
  it("is deterministic", () => {
    expect(localEmbed("free shipping above 499")).toEqual(localEmbed("free shipping above 499"));
  });

  it("produces unit-length vectors", () => {
    const vec = localEmbed("returns within seven days");
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("scores related text above unrelated text", () => {
    const query = localEmbed("what is the shipping fee");
    const related = localEmbed("orders below 499 incur a shipping fee");
    const unrelated = localEmbed("cash on delivery up to 2500");
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });

  it("exposes an async provider with a stable id", async () => {
    const provider = localEmbeddingProvider(64);
    const [vec] = await provider.embed(["hello world"]);
    expect(provider.id).toContain("local-hash");
    expect(vec).toHaveLength(64);
  });
});

describe("chunkDocument", () => {
  it("splits long text into overlapping, sentence-aligned chunks", () => {
    const long = doc({
      text: Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about returns.`).join(" "),
    });
    const chunks = chunkDocument(long, { maxChars: 200, overlapChars: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const [i, chunk] of chunks.entries()) {
      expect(chunk.id).toBe(`doc-1#${i}`);
      expect(chunk.index).toBe(i);
      expect(chunk.text.length).toBeLessThanOrEqual(200 + 40);
    }
  });

  it("keeps short documents as a single chunk and carries metadata", () => {
    const chunks = chunkDocuments([doc({ metadata: { k: "v" } })]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata).toEqual({ k: "v" });
    expect(chunks[0].companyId).toBe("acme");
  });
});
