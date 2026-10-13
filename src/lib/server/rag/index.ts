export {
  LOCAL_EMBED_DIM,
  cosine,
  localEmbed,
  localEmbeddingProvider,
  ollamaEmbeddingProvider,
  resolveEmbeddingProvider,
  tokenize,
  type EmbeddingProvider,
  type OllamaEmbedOptions,
} from "./embed";
export { chunkDocument, chunkDocuments, type ChunkOptions } from "./chunk";
export { VectorIndex, type IndexStats, type VectorHit } from "./store";
export { retrieve, type RetrievalDebug } from "./retrieve";
export {
  DEFAULT_COMPANY_ID,
  auraPolicyDocuments,
  auraProductDocuments,
  defaultTenant,
  tenantDocuments,
  type Tenant,
  type TenantDocument,
} from "./corpus";
export {
  buildRagIndex,
  getEmbeddingProvider,
  getRagIndex,
  knowledgeToDocuments,
  resetRagCache,
  retrievePassages,
  type BuildRagIndexOptions,
  type RetrievePassagesOptions,
} from "./context";
export type {
  RagChunk,
  RagDocument,
  RetrievedPassage,
  RetrieveOptions,
  ScoredChunk,
} from "./types";
export {
  SFT_SYSTEM_PROMPT,
  buildSftDataset,
  datasetStats,
  knowledgeToSample,
  sessionToSample,
  toJsonl,
  type BuildDatasetInput,
  type BuildDatasetOptions,
  type DatasetSource,
  type DatasetStats,
  type SftMessage,
  type SftSample,
} from "./dataset";
