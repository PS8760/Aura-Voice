import type { RagChunk, RagDocument } from "./types";

export interface ChunkOptions {
  /** Target maximum characters per chunk. */
  maxChars?: number;
  /** Characters of trailing context repeated at the head of the next chunk. */
  overlapChars?: number;
}

const DEFAULT_MAX_CHARS = 700;
const DEFAULT_OVERLAP = 120;

/** Split into sentences, keeping the terminator. Handles ., !, ?, and the danda. */
function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?।])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text.trim()].filter(Boolean);
}

function tail(text: string, chars: number): string {
  if (chars <= 0 || text.length <= chars) return chars <= 0 ? "" : text;
  return text.slice(text.length - chars);
}

/**
 * Split a document into overlapping, sentence-aligned chunks. Overlap keeps
 * facts that straddle a boundary retrievable from either side.
 */
export function chunkDocument(
  doc: RagDocument,
  options: ChunkOptions = {},
): RagChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP;

  const sentences = splitSentences(doc.text);
  const chunks: RagChunk[] = [];
  let current: string[] = [];
  let lead = "";

  const flush = () => {
    const body = `${lead}${current.join(" ")}`.trim();
    if (!body) return;
    chunks.push(toChunk(doc, body, chunks.length));
    lead = tail(body, overlapChars);
    current = [];
  };

  for (const sentence of sentences) {
    const tentative = `${lead}${[...current, sentence].join(" ")}`.trim();
    if (tentative.length > maxChars && current.length > 0) {
      flush();
    }
    current.push(sentence);
  }
  flush();

  return chunks;
}

function toChunk(doc: RagDocument, text: string, index: number): RagChunk {
  return {
    id: `${doc.id}#${index}`,
    documentId: doc.id,
    companyId: doc.companyId,
    title: doc.title,
    text,
    source: doc.source,
    index,
    intent: doc.intent ?? null,
    locale: doc.locale ?? null,
    metadata: doc.metadata,
  };
}

export function chunkDocuments(
  docs: RagDocument[],
  options: ChunkOptions = {},
): RagChunk[] {
  return docs.flatMap((doc) => chunkDocument(doc, options));
}
