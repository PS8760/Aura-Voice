import type { VectorIndex, VectorHit } from "./store";
import type { RetrievedPassage, RetrieveOptions } from "./types";

/** Reciprocal-rank-fusion constant. 60 is the standard from the RRF paper. */
const RRF_K = 60;
const DEFAULT_K = 4;
const CANDIDATES = 12;

export interface RetrievalDebug {
  query: string;
  lexical: number;
  vector: number;
  passages: RetrievedPassage[];
}

interface Candidate {
  hit: VectorHit;
  fused: number;
  lexical: number;
  vector: number;
}

/**
 * Hybrid retrieval: fuse dense (semantic) and BM25 (lexical) rankings with
 * reciprocal-rank fusion, then nudge chunks whose soft hints match the turn's
 * intent/locale. RRF is rank-based, so the two very different score scales
 * combine without hand-tuned weights.
 */
export async function retrieve(
  index: VectorIndex,
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievedPassage[]> {
  const k = options.k ?? DEFAULT_K;
  const companyId = options.companyId;
  const trimmed = query.trim();
  if (!trimmed || index.size === 0) return [];

  const pool = new Map<string, Candidate>();

  const queryVector = await index.embedQuery(trimmed);
  const dense = index.dense(queryVector, CANDIDATES, companyId);
  dense.forEach((hit, rank) => {
    const existing = pool.get(hit.chunk.id) ?? {
      hit,
      fused: 0,
      lexical: 0,
      vector: hit.score,
    };
    existing.fused += 1 / (RRF_K + rank + 1);
    existing.vector = hit.score;
    pool.set(hit.chunk.id, existing);
  });

  const lexical = index.bm25(trimmed, CANDIDATES, companyId);
  lexical.forEach((hit, rank) => {
    const existing = pool.get(hit.chunk.id) ?? {
      hit,
      fused: 0,
      lexical: 0,
      vector: 0,
    };
    existing.fused += 1 / (RRF_K + rank + 1);
    existing.lexical = hit.score;
    pool.set(hit.chunk.id, existing);
  });

  const passages = Array.from(pool.values())
    .map((candidate) => {
      let score = candidate.fused;
      if (options.intent && candidate.hit.chunk.intent === options.intent) score *= 1.25;
      if (options.locale && candidate.hit.chunk.locale === options.locale) score *= 1.1;
      return {
        id: "",
        documentId: candidate.hit.chunk.documentId,
        title: candidate.hit.chunk.title,
        source: candidate.hit.chunk.source,
        text: candidate.hit.chunk.text,
        intent: candidate.hit.chunk.intent,
        locale: candidate.hit.chunk.locale,
        score,
        lexical: candidate.lexical,
        vector: candidate.vector,
      } satisfies RetrievedPassage;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return passages.map((passage, i) => ({ ...passage, id: `K${i + 1}` }));
}
