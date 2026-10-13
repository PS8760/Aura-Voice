import { cosine, tokenize, type EmbeddingProvider } from "./embed";
import type { RagChunk } from "./types";

export interface VectorHit {
  chunk: RagChunk;
  score: number;
}

interface IndexedChunk {
  chunk: RagChunk;
  vector: number[];
  tf: Map<string, number>;
  length: number;
}

export interface IndexStats {
  documents: number;
  vocabulary: number;
  averageLength: number;
  embedderId: string;
  dimension: number;
}

/**
 * In-memory hybrid index: dense vectors for semantic recall plus token
 * statistics for BM25 lexical recall. Small enough for a per-tenant KB, and it
 * rebuilds from the corpus on demand — no external vector DB needed.
 */
export class VectorIndex {
  private items: IndexedChunk[] = [];
  private df = new Map<string, number>();

  constructor(private readonly embedder: EmbeddingProvider) {}

  get size(): number {
    return this.items.length;
  }

  get embedderId(): string {
    return this.embedder.id;
  }

  stats(): IndexStats {
    const total = this.items.reduce((sum, item) => sum + item.length, 0);
    return {
      documents: this.items.length,
      vocabulary: this.df.size,
      averageLength: this.items.length === 0 ? 0 : total / this.items.length,
      embedderId: this.embedder.id,
      dimension: this.embedder.dimension,
    };
  }

  /** Replace the whole index with the supplied chunks. */
  async build(chunks: RagChunk[]): Promise<void> {
    this.items = [];
    this.df = new Map();
    await this.add(chunks);
  }

  async add(chunks: RagChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const vectors = await this.embedder.embed(chunks.map((c) => c.text));
    chunks.forEach((chunk, i) => {
      const tokens = tokenize(chunk.text);
      const tf = new Map<string, number>();
      for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
      for (const token of new Set(tokens)) this.df.set(token, (this.df.get(token) ?? 0) + 1);
      this.items.push({ chunk, vector: vectors[i], tf, length: tokens.length });
    });
  }

  private filter(companyId?: string): IndexedChunk[] {
    if (!companyId) return this.items;
    return this.items.filter((item) => item.chunk.companyId === companyId);
  }

  /** Dense cosine search. */
  dense(queryVector: number[], k: number, companyId?: string): VectorHit[] {
    return this.filter(companyId)
      .map((item) => ({ chunk: item.chunk, score: cosine(queryVector, item.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /** Okapi BM25 lexical search. */
  bm25(query: string, k: number, companyId?: string): VectorHit[] {
    const candidates = this.filter(companyId);
    if (candidates.length === 0) return [];

    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const N = candidates.length;
    const avgdl =
      candidates.reduce((sum, item) => sum + item.length, 0) / N || 1;
    const k1 = 1.5;
    const b = 0.75;

    const scored = candidates.map((item) => {
      let score = 0;
      for (const token of tokens) {
        const df = this.df.get(token) ?? 0;
        if (df === 0) continue;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const freq = item.tf.get(token) ?? 0;
        if (freq === 0) continue;
        const denom = freq + k1 * (1 - b + (b * item.length) / avgdl);
        score += idf * ((freq * (k1 + 1)) / denom);
      }
      return { chunk: item.chunk, score };
    });

    return scored
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async embedQuery(query: string): Promise<number[]> {
    const [vector] = await this.embedder.embed([query]);
    return vector;
  }
}
