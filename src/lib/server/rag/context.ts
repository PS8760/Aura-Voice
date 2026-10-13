import type { KnowledgeEntry } from "@/lib/server/db/types";
import { chunkDocuments } from "./chunk";
import {
  localEmbeddingProvider,
  resolveEmbeddingProvider,
  type EmbeddingProvider,
} from "./embed";
import { defaultTenant, tenantDocuments, type Tenant } from "./corpus";
import { retrieve } from "./retrieve";
import { VectorIndex } from "./store";
import type { RagDocument, RetrievedPassage, RetrieveOptions } from "./types";

/* ------------------------------------------------------------------ bridge */

/** Approved knowledge entries become first-class retrieval documents. */
export function knowledgeToDocuments(
  entries: KnowledgeEntry[],
  companyId: string,
): RagDocument[] {
  return entries.map((entry) => ({
    id: `knowledge:${entry.id}`,
    companyId,
    title: entry.question,
    text: `${entry.question}\n${entry.answer}`,
    source: "knowledge",
    intent: entry.intent,
    locale: entry.locale,
    metadata: { knowledgeId: entry.id },
  }));
}

/* ------------------------------------------------------------------ build */

export interface BuildRagIndexOptions {
  tenant?: Tenant;
  knowledge?: KnowledgeEntry[];
  embedder?: EmbeddingProvider;
}

export async function buildRagIndex(
  options: BuildRagIndexOptions = {},
): Promise<VectorIndex> {
  const tenant = options.tenant ?? defaultTenant();
  const embedder = options.embedder ?? localEmbeddingProvider();
  const docs = [
    ...tenantDocuments(tenant),
    ...knowledgeToDocuments(options.knowledge ?? [], tenant.companyId),
  ];
  const index = new VectorIndex(embedder);
  await index.build(chunkDocuments(docs));
  return index;
}

/* ------------------------------------------------------------------ cache */

interface CachedIndex {
  signature: string;
  index: VectorIndex;
}

const cache = new Map<string, CachedIndex>();
let embeddingProviderPromise: Promise<EmbeddingProvider> | null = null;

/** Resolve once per process; probing Ollama on every turn would be wasteful. */
export function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (!embeddingProviderPromise) {
    embeddingProviderPromise = resolveEmbeddingProvider().catch(() =>
      localEmbeddingProvider(),
    );
  }
  return embeddingProviderPromise;
}

/** Reset memoised state. Used by tests. */
export function resetRagCache(): void {
  cache.clear();
  embeddingProviderPromise = null;
}

function signatureOf(knowledge: KnowledgeEntry[]): string {
  return knowledge
    .map((entry) => `${entry.id}:${entry.updatedAt}`)
    .sort()
    .join("|");
}

/**
 * Process-cached index for a tenant. Rebuilds only when the approved knowledge
 * set changes, so turns stay fast without a persistent vector database.
 */
export async function getRagIndex(
  companyId: string,
  knowledge: KnowledgeEntry[],
  tenant?: Tenant,
): Promise<VectorIndex> {
  const signature = signatureOf(knowledge);
  const cached = cache.get(companyId);
  if (cached && cached.signature === signature) return cached.index;

  const embedder = await getEmbeddingProvider();
  const index = await buildRagIndex({ tenant, knowledge, embedder });
  cache.set(companyId, { signature, index });
  return index;
}

/* ------------------------------------------------------------------ retrieve */

export interface RetrievePassagesOptions extends RetrieveOptions {
  knowledge?: KnowledgeEntry[];
  tenant?: Tenant;
}

/** One call the turn route makes: get the top-k grounded, cited passages. */
export async function retrievePassages(
  query: string,
  options: RetrievePassagesOptions = {},
): Promise<RetrievedPassage[]> {
  const tenant = options.tenant ?? defaultTenant();
  const companyId = options.companyId ?? tenant.companyId;
  try {
    const index = await getRagIndex(companyId, options.knowledge ?? [], tenant);
    return await retrieve(index, query, { ...options, companyId });
  } catch {
    return [];
  }
}
