import type { KnowledgeEntry, StoredSession } from "@/lib/server/db/types";
import type { Intent } from "@/lib/domain/types";
import type { Locale } from "@/lib/domain/locale";

/**
 * Supervised fine-tuning (SFT) dataset builder.
 *
 * Fine-tuning is the second half of the "humanised, policy-grounded" story:
 * retrieval teaches the model *what is true*, fine-tuning teaches it *how to
 * sound*. This module turns real, high-quality, already-verified interactions
 * into instruction/response pairs in the chat JSONL format that LoRA trainers
 * (Unsloth, Axolotl, HF TRL) consume.
 *
 * It only ever exports examples that passed the product's own guardrails, so the
 * model is never trained to imitate a rejected or unresolved reply.
 */

export type DatasetSource = "session" | "knowledge";

export interface SftMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SftSample {
  messages: SftMessage[];
  metadata: {
    source: DatasetSource;
    intent: Intent | null;
    locale: Locale;
    sessionId?: string;
    knowledgeId?: string;
  };
}

export interface DatasetStats {
  total: number;
  fromSessions: number;
  fromKnowledge: number;
  byIntent: Record<string, number>;
  byLocale: Record<string, number>;
  skipped: number;
}

/** Persona + grounding system prompt the tuned model learns to obey. */
export const SFT_SYSTEM_PROMPT = [
  "You are a warm, concise voice support agent for {brand}.",
  "Answer only from the verified facts you are given (tool results and retrieved passages).",
  "Never invent order ids, couriers, tracking numbers, prices, dates or policy values.",
  "You may paraphrase policy facts, but you must never add, drop or reverse them.",
  "Keep numbers exactly as digits. Keep replies to 2-4 spoken sentences.",
].join(" ");

export interface BuildDatasetOptions {
  /** Brand used in the system prompt. Defaults to a generic company name. */
  brand?: string;
  /** Intents considered in-scope and therefore worth training on. */
  supportedIntents?: Intent[];
}

const DEFAULT_SUPPORTED_INTENTS: Intent[] = [
  "ORDER_TRACKING",
  "RETURN_REQUEST",
  "CANCELLATION_REQUEST",
  "SHIPPING_QUERY",
  "COD_QUERY",
  "DAMAGED_PRODUCT",
  "GENERAL_PRODUCT_QUERY",
];

function systemMessage(brand: string): SftMessage {
  return { role: "system", content: SFT_SYSTEM_PROMPT.replace("{brand}", brand) };
}

/** A session becomes training data only if it ended well and stayed in scope. */
export function sessionToSample(
  session: StoredSession,
  options: BuildDatasetOptions = {},
): SftSample | null {
  if (session.resolution !== "RESOLVED") return null;
  if (!session.intent) return null;
  if (!session.lastReply || session.lastReply.trim().length === 0) return null;
  if (!session.summary || session.summary.trim().length === 0) return null;

  const supported = options.supportedIntents ?? DEFAULT_SUPPORTED_INTENTS;
  if (!supported.includes(session.intent)) return null;

  return {
    messages: [
      systemMessage(options.brand ?? "the company"),
      { role: "user", content: session.summary },
      { role: "assistant", content: session.lastReply },
    ],
    metadata: {
      source: "session",
      intent: session.intent,
      locale: session.locale,
      sessionId: session.id,
    },
  };
}

/** Approved knowledge becomes direct instruction/response pairs. */
export function knowledgeToSample(entry: KnowledgeEntry): SftSample | null {
  if (!entry.approved) return null;
  if (!entry.question.trim() || !entry.answer.trim()) return null;
  return {
    messages: [
      systemMessage("the company"),
      { role: "user", content: entry.question },
      { role: "assistant", content: entry.answer },
    ],
    metadata: {
      source: "knowledge",
      intent: entry.intent,
      locale: entry.locale,
      knowledgeId: entry.id,
    },
  };
}

export interface BuildDatasetInput {
  sessions?: StoredSession[];
  knowledge?: KnowledgeEntry[];
  options?: BuildDatasetOptions;
}

export function buildSftDataset(input: BuildDatasetInput = {}): SftSample[] {
  const sessions = input.sessions ?? [];
  const knowledge = input.knowledge ?? [];
  const samples: SftSample[] = [];

  for (const session of sessions) {
    const sample = sessionToSample(session, input.options);
    if (sample) samples.push(sample);
  }
  for (const entry of knowledge) {
    const sample = knowledgeToSample(entry);
    if (sample) samples.push(sample);
  }
  return samples;
}

export function datasetStats(samples: SftSample[], skipped = 0): DatasetStats {
  const byIntent: Record<string, number> = {};
  const byLocale: Record<string, number> = {};
  let fromSessions = 0;
  let fromKnowledge = 0;

  for (const sample of samples) {
    if (sample.metadata.source === "session") fromSessions += 1;
    else fromKnowledge += 1;
    const intent = sample.metadata.intent ?? "UNKNOWN";
    byIntent[intent] = (byIntent[intent] ?? 0) + 1;
    byLocale[sample.metadata.locale] = (byLocale[sample.metadata.locale] ?? 0) + 1;
  }

  return {
    total: samples.length,
    fromSessions,
    fromKnowledge,
    byIntent,
    byLocale,
    skipped,
  };
}

/** Serialise samples to chat JSONL — one JSON object per line. */
export function toJsonl(samples: SftSample[]): string {
  return samples
    .map((sample) => JSON.stringify({ messages: sample.messages }))
    .join("\n");
}
