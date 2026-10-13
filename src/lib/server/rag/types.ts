import type { Intent } from "@/lib/domain/types";
import type { Locale } from "@/lib/domain/locale";

/**
 * A knowledge document for a tenant. `companyId` namespaces everything so the
 * same engine can serve any company — Aura is just the default tenant.
 */
export interface RagDocument {
  id: string;
  companyId: string;
  title: string;
  text: string;
  /** Where this came from: "policy" | "faq" | "product" | "order" | "knowledge" | ... */
  source: string;
  /** Soft routing hints. Retrieval may boost chunks whose hints match the turn. */
  intent?: Intent | null;
  locale?: Locale | null;
  metadata?: Record<string, string>;
}

export interface RagChunk {
  id: string;
  documentId: string;
  companyId: string;
  title: string;
  text: string;
  source: string;
  /** Position of this chunk within its document. */
  index: number;
  intent: Intent | null;
  locale: Locale | null;
  metadata?: Record<string, string>;
}

export interface ScoredChunk {
  chunk: RagChunk;
  score: number;
}

/** A citation-backed passage handed to the model and returned to the client. */
export interface RetrievedPassage {
  /** Stable citation id, e.g. "K1". */
  id: string;
  documentId: string;
  title: string;
  source: string;
  text: string;
  intent: Intent | null;
  locale: Locale | null;
  score: number;
  lexical: number;
  vector: number;
}

export interface RetrieveOptions {
  k?: number;
  companyId?: string;
  intent?: Intent | null;
  locale?: Locale | null;
}
