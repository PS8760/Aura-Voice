/**
 * Embeddings for retrieval.
 *
 * Two interchangeable providers:
 *
 *  - `localEmbeddingProvider` — a dependency-free, fully deterministic hashed
 *    bag-of-words + bigram embedder. It needs no model and no network, so the
 *    RAG stack works at ₹0 and offline.
 *  - `ollamaEmbeddingProvider` — real dense vectors from a local Ollama model
 *    (e.g. `nomic-embed-text`) when one is reachable.
 *
 * Both satisfy the same `EmbeddingProvider` interface, so nothing downstream
 * cares which is active. Vectors are always L2-normalised, which makes cosine
 * similarity a plain dot product.
 */

export const LOCAL_EMBED_DIM = 384;

export interface EmbeddingProvider {
  readonly id: string;
  readonly dimension: number;
  embed(texts: string[]): Promise<number[][]>;
}

/* ------------------------------------------------------------------ tokens */

const TOKEN_RE = /[\p{L}\p{N}\p{M}]+/gu;

/** Lowercase, script-preserving tokens (keeps हिन्दी / বাংলা / தமிழ் / मराठी). */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_RE) ?? []).filter((t) => t.length > 0);
}

/** FNV-1a 32-bit hash. Deterministic across runs and platforms. */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The signed hashing trick: a feature hashes to a bucket and a sign, which
 * keeps collisions roughly unbiased and preserves relative similarity.
 */
function accumulate(vec: Float64Array, feature: string, weight: number): void {
  const bucket = fnv1a(feature) % vec.length;
  const sign = (fnv1a(`sign:${feature}`) & 1) === 0 ? 1 : -1;
  vec[bucket] += sign * weight;
}

function l2Normalize(vec: Float64Array): number[] {
  let sum = 0;
  for (const value of vec) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0) return Array.from(vec);
  const out = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i += 1) out[i] = vec[i] / norm;
  return out;
}

/**
 * Deterministic local embedding.
 * Unigrams carry full weight, adjacent bigrams less (to add a little order
 * sensitivity without swamping the signal).
 */
export function localEmbed(text: string, dimension = LOCAL_EMBED_DIM): number[] {
  const tokens = tokenize(text);
  const vec = new Float64Array(dimension);

  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);

  for (const [token, count] of tf) {
    // Sublinear term frequency: 1 + log(tf).
    accumulate(vec, `w:${token}`, 1 + Math.log(count));
  }
  for (let i = 1; i < tokens.length; i += 1) {
    accumulate(vec, `b:${tokens[i - 1]}_${tokens[i]}`, 0.5);
  }

  return l2Normalize(vec);
}

/** Cosine similarity. Inputs are expected to be L2-normalised, so this is a dot product. */
export function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < length; i += 1) dot += a[i] * b[i];
  return dot;
}

export function localEmbeddingProvider(dimension = LOCAL_EMBED_DIM): EmbeddingProvider {
  return {
    id: `local-hash-${dimension}`,
    dimension,
    async embed(texts: string[]) {
      return texts.map((text) => localEmbed(text, dimension));
    },
  };
}

/* ------------------------------------------------------------------ Ollama */

const EMBED_TIMEOUT_MS = 4_000;

export interface OllamaEmbedOptions {
  baseUrl?: string;
  model?: string;
  dimension?: number;
  fetchImpl?: typeof fetch;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe Ollama for an embedding model. Returns `null` on any failure so callers
 * fall back to the local embedder — embedding availability must never break a
 * turn.
 */
export async function ollamaEmbeddingProvider(
  options: OllamaEmbedOptions = {},
): Promise<EmbeddingProvider | null> {
  const baseUrl = (options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = options.model ?? process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const probe = await fetchWithTimeout(
      `${baseUrl}/api/embeddings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: "ping" }),
      },
      EMBED_TIMEOUT_MS,
      fetchImpl,
    );
    if (!probe.ok) return null;
    const first = (await probe.json()) as { embedding?: number[] };
    if (!Array.isArray(first.embedding) || first.embedding.length === 0) return null;
    const dimension = first.embedding.length;

    return {
      id: `ollama-${model}`,
      dimension,
      async embed(texts: string[]) {
        const vectors: number[][] = [];
        for (const text of texts) {
          const res = await fetchWithTimeout(
            `${baseUrl}/api/embeddings`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model, prompt: text }),
            },
            EMBED_TIMEOUT_MS,
            fetchImpl,
          );
          if (!res.ok) throw new Error(`embedding request failed: ${res.status}`);
          const data = (await res.json()) as { embedding?: number[] };
          if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
            throw new Error("embedding response was empty");
          }
          vectors.push(data.embedding);
        }
        return vectors;
      },
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the best available provider: a real Ollama embedder if reachable,
 * otherwise the deterministic local one.
 */
export async function resolveEmbeddingProvider(
  options: OllamaEmbedOptions = {},
): Promise<EmbeddingProvider> {
  const remote = await ollamaEmbeddingProvider(options);
  return remote ?? localEmbeddingProvider(options.dimension);
}
