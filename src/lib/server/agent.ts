import type { OrderRepository } from "@/lib/domain/orders";
import {
  ConversationOrchestrator,
  type ActivityEvent,
  type SessionState,
  type TurnResult,
} from "@/lib/domain/orchestrator";
import { extractOrderId } from "@/lib/domain/intent";
import { DEFAULT_LOCALE, LOCALE_META, type Locale } from "@/lib/domain/locale";
import type { RetrievedPassage } from "@/lib/server/rag/types";

import {
  AGENT_TOOLS,
  executeAgentTool,
  parseUnderstanding,
  type AgentToolName,
  type AgentUnderstanding,
} from "./agentTools";
import { localAiEnabled } from "./ollama";

/**
 * Enterprise agent layer.
 *
 * Language understanding is delegated to a locally-hosted model (Ollama), but
 * every eligibility decision, every reply that touches policy, and every action
 * execution stays in the deterministic orchestrator. If the model is
 * unreachable, times out, or produces something that fails the guardrails, the
 * caller falls back to the pure rule-based engine.
 */

const MAX_STEPS = 4;
const CHAT_TIMEOUT_MS = 12_000;
const ACCEPTED_DRAFT_INTENTS = new Set(["ORDER_TRACKING", "COD_QUERY", "SHIPPING_QUERY"]);
const KNOWN_COURIERS = ["bluedart", "delhivery"];
const MOCK_WORDS: Record<Locale, RegExp> = {
  en: /\bmock\b/i,
  hi: /मॉक/,
  bn: /মক/,
  ta: /மாதிரி/,
  mr: /मॉक/,
};

/**
 * Negation / refusal markers used to prove a paraphrased reply did not silently
 * turn a denial into an approval. When the authoritative engine reply contains
 * one of these, the draft must contain one too.
 */
const NEGATION_MARKERS: Record<Locale, RegExp> = {
  en: /\b(cannot|can not|can't|unable|not able|not eligible|not permitted|outside|no longer|not available|not possible|won't|will not|sorry|unfortunately)\b/i,
  hi: /(नहीं|नही|संभव नहीं|असंभव|क्षमा)/,
  bn: /(না|নয়|সম্ভব নয়|দুঃখিত)/,
  ta: /(இல்லை|முடியாது|இயலாது|மன்னிக்கவும்)/,
  mr: /(नाही|शक्य नाही|क्षमस्व)/,
};

const SYSTEM_PROMPT = [
  "You are Aria, the customer support agent for Aura Skincare, an Indian skincare brand.",
  "You help with order tracking, cancellations, returns, shipping charges, Cash on Delivery and damaged products.",
  "Use the provided tools to fetch verified order facts and policy decisions BEFORE answering. Never guess.",
  "You must never invent order data, courier names, tracking numbers, delivery dates, prices or policy values.",
  "Retrieved passages are marked [K1], [K2] and so on. Ground every factual claim in the tool results or a retrieved passage, and cite the passages you use.",
  "Aria can only answer the supported topics. For anything else (weather, general chit-chat, other brands), submit intent OUT_OF_SCOPE.",
  "When the customer is ambiguous (e.g. talks about 'my order' without saying what they want), submit intent UNKNOWN with needs_clarification set to order_action.",
  "If no order id is available and one is required, submit UNKNOWN with needs_clarification set to order_id.",
  "When you have enough verified facts, finish by calling submit_understanding. This is required.",
  "Always include draft_reply. For ORDER_TRACKING, COD_QUERY and SHIPPING_QUERY you may compose a fresh reply from the verified tool results and retrieved passages.",
  "For every other intent you may only humanise the verified decision returned by the tools: paraphrase it warmly, keep every number exactly as digits, keep every order id, courier name and tracking reference unchanged, and never add, drop or reverse a fact (for example you must not say a decline succeeded).",
  // Few-shot routing exemplars keep the model aligned with the deterministic
  // engine's intent taxonomy and guardrails.
  "Examples: \"where is my parcel\" -> ORDER_TRACKING (ask for order id if none). " +
    "\"cancel it, I changed my mind\" -> CANCELLATION_REQUEST. " +
    "\"the bottle leaked, it arrived broken\" -> DAMAGED_PRODUCT. " +
    "\"can I pay when it arrives\" -> COD_QUERY. " +
    "\"what will delivery cost me\" -> SHIPPING_QUERY. " +
    "\"do you sell lip balm\" -> OUT_OF_SCOPE. " +
    "\"this is the third time I've asked and I'm furious\" -> keep the intent, set sentiment frustrated.",
].join(" ");

interface ToolCall {
  function: { name: string; arguments: unknown };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
}

interface ChatResponseMessage {
  content?: string;
  tool_calls?: unknown;
}

export interface AgentCitation {
  id: string;
  title: string;
  source: string;
}

export interface AgentMetrics {
  steps: number;
  toolCalls: string[];
  acceptedDraft: boolean;
  /** True when a draft was submitted but the guardrail rejected it. */
  rejectedDraft: boolean;
  understanding: AgentUnderstanding;
  /** Retrieved passages the model had available, as citation references. */
  citations: AgentCitation[];
}

export interface AgentTurnOutcome {
  result: TurnResult;
  aiUsed: true;
  metrics: AgentMetrics;
}

export interface RunSupportAgentInput {
  text: string;
  state: SessionState;
  repo: OrderRepository;
  locale?: Locale;
  /** Approved knowledge-base answers relevant to this utterance. */
  knowledge?: { question: string; answer: string }[];
  /** Retrieved, cited passages from the tenant knowledge base (RAG). */
  passages?: RetrievedPassage[];
  /** Recent turns (oldest first), replayed because the server is stateless. */
  history?: { role: "customer" | "agent"; text: string }[];
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

/* ------------------------------------------------------------------ Ollama */

function endpoint(): string {
  return (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
}

async function ollamaChat(
  messages: ChatMessage[],
  fetchImpl: typeof fetch,
): Promise<ChatResponseMessage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${endpoint()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL ?? "llama3.2",
        messages,
        tools: AGENT_TOOLS,
        stream: false,
        options: { temperature: 0 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: ChatResponseMessage };
    return data.message ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: ToolCall[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const fn = (entry as { function?: unknown }).function;
    if (!fn || typeof fn !== "object") continue;
    const name = (fn as { name?: unknown }).name;
    if (typeof name !== "string") continue;
    calls.push({ function: { name, arguments: (fn as { arguments?: unknown }).arguments } });
  }
  return calls;
}

function safeArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

let agentEventCounter = 0;
function agentEvent(
  label: string,
  detail: string,
  status: ActivityEvent["status"],
): ActivityEvent {
  agentEventCounter += 1;
  return {
    id: `evt_agent_${agentEventCounter.toString(36)}_${Date.now().toString(36)}`,
    type: status === "warn" ? "clarification_requested" : "result_returned",
    label,
    detail,
    status,
    at: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------- guardrails */

function orderIdsIn(text: string): string[] {
  return (text.match(/ord[-\s]?\d{1,4}/gi) ?? []).map((m) => m.toUpperCase().replace(/\s/g, "-"));
}

interface DraftContext {
  draft: string;
  result: TurnResult;
  text: string;
  locale?: Locale;
  observedOrderIds: Set<string>;
  observedCouriers: Set<string>;
  observedTrackingRefs: Set<string>;
  /** The authoritative engine reply, used to prove a paraphrase changed nothing. */
  sourceReply?: string;
}

function numericTokens(text: string): Set<string> {
  return new Set(text.match(/\d+/g) ?? []);
}

/** Every order id that is legitimately in play for this turn. */
function allowedOrderIds(ctx: DraftContext): Set<string> {
  const ids = new Set<string>([...ctx.observedOrderIds, ...orderIdsIn(ctx.text)]);
  if (ctx.result.orderId) ids.add(ctx.result.orderId);
  return ids;
}

/** Checks shared by both draft modes: no invented entities, sane size. */
function checkEntities(ctx: DraftContext): { accepted: boolean; reason: string } {
  const draft = ctx.draft.trim();
  if (!draft) return { accepted: false, reason: "empty draft" };
  if (draft.length > 800) return { accepted: false, reason: "draft too long" };
  if (
    ctx.result.intent === "ORDER_TRACKING" &&
    !MOCK_WORDS[ctx.locale ?? DEFAULT_LOCALE].test(draft)
  ) {
    return { accepted: false, reason: "missing mock-data disclaimer" };
  }

  const allowedIds = allowedOrderIds(ctx);
  for (const id of orderIdsIn(draft)) {
    if (!allowedIds.has(id)) return { accepted: false, reason: `invented order id ${id}` };
  }

  for (const courier of KNOWN_COURIERS) {
    if (new RegExp(`\\b${courier}\\b`, "i").test(draft) && !ctx.observedCouriers.has(courier)) {
      return { accepted: false, reason: `unverified courier ${courier}` };
    }
  }
  for (const ref of draft.match(/\b[A-Z]{2}-\d{6}\b/g) ?? []) {
    if (!ctx.observedTrackingRefs.has(ref.toUpperCase())) {
      return { accepted: false, reason: `unverified tracking reference ${ref}` };
    }
  }
  return { accepted: true, reason: "ok" };
}

/** Informational intents may be composed fresh, as long as they stay verified. */
function validateCompose(ctx: DraftContext): { accepted: boolean; reason: string } {
  if (!ACCEPTED_DRAFT_INTENTS.has(ctx.result.intent)) {
    return { accepted: false, reason: "intent requires verified wording" };
  }
  if (ctx.result.resolution !== "RESOLVED" || ctx.result.policyExplanation) {
    return { accepted: false, reason: "policy wording must come from the engine" };
  }
  return checkEntities(ctx);
}

/**
 * Decision intents (returns, cancellations, damage, out-of-scope...) may only be
 * *humanised*: the draft must preserve the engine's meaning. We enforce that no
 * number was invented, no entity was invented, and a refusal was not turned into
 * an approval.
 */
function validateParaphrase(ctx: DraftContext): { accepted: boolean; reason: string } {
  const entities = checkEntities(ctx);
  if (!entities.accepted) return entities;

  const source = ctx.sourceReply?.trim();
  if (!source) return { accepted: false, reason: "no verified reply to paraphrase" };

  const locale = ctx.locale ?? DEFAULT_LOCALE;
  const allowedNumbers = numericTokens(source);
  for (const id of allowedOrderIds(ctx)) for (const n of numericTokens(id)) allowedNumbers.add(n);
  for (const ref of ctx.observedTrackingRefs) {
    for (const n of numericTokens(ref)) allowedNumbers.add(n);
  }
  for (const token of numericTokens(ctx.draft)) {
    if (!allowedNumbers.has(token)) {
      return { accepted: false, reason: `invented number ${token}` };
    }
  }

  if (NEGATION_MARKERS[locale].test(source) && !NEGATION_MARKERS[locale].test(ctx.draft)) {
    return { accepted: false, reason: "paraphrase dropped the refusal" };
  }

  return { accepted: true, reason: "ok" };
}

/**
 * Decide whether the model's drafted reply may be used.
 *
 * Informational intents are validated as freshly-composed, fully-verified prose.
 * All other intents are validated as paraphrases of the authoritative engine
 * reply, so a reply can sound human without ever contradicting policy.
 */
export function validateDraft(ctx: DraftContext): { accepted: boolean; reason: string } {
  return ACCEPTED_DRAFT_INTENTS.has(ctx.result.intent)
    ? validateCompose(ctx)
    : validateParaphrase(ctx);
}

/* --------------------------------------------------------------- main loop */

function buildUserContext(
  text: string,
  state: SessionState,
  history: { role: "customer" | "agent"; text: string }[] = [],
): string {
  const parts: string[] = [];
  if (history.length > 0) {
    const recent = history
      .slice(-8)
      .map((turn) => `${turn.role === "customer" ? "Customer" : "Aria"}: ${turn.text}`)
      .join("\n");
    parts.push(`Recent conversation:\n${recent}`);
  }
  parts.push(`Customer message: ${text}`);
  if (state.orderId) parts.push(`Order id already known from earlier: ${state.orderId}.`);
  if (state.intent) parts.push(`Previous intent: ${state.intent}.`);
  if (state.lastSummary) parts.push(`Earlier summary: ${state.lastSummary}`);
  return parts.join("\n");
}

export async function runSupportAgent(
  input: RunSupportAgentInput,
): Promise<AgentTurnOutcome | null> {
  if (!localAiEnabled()) return null;

  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => new Date());
  const { text, state, repo } = input;
  const locale = input.locale ?? DEFAULT_LOCALE;

  const languageLine =
    locale === DEFAULT_LOCALE
      ? ""
      : ` The customer is using ${LOCALE_META[locale].label}. Write the draft_reply in ${LOCALE_META[locale].label}, but keep intent values, order ids, courier names and tracking references exactly as returned by the tools.`;

  // Human-approved knowledge retrieved for this utterance. It may inform the
  // wording, but never overrides tool results or policy.
  const knowledge = (input.knowledge ?? []).filter((k) => k.answer.trim().length > 0);
  const knowledgeBlock =
    knowledge.length > 0
      ? ` Approved knowledge you may use when relevant: ${knowledge
          .map((k) => `Q: ${k.question} A: ${k.answer}`)
          .join(" | ")}`
      : "";

  // Retrieved, cited passages from the tenant knowledge base (RAG). These give
  // the model grounded wording; they never override tool results or policy.
  const passages = input.passages ?? [];
  const passagesBlock =
    passages.length > 0
      ? ` Retrieved passages (ground your wording in these and cite them inline as [K1], [K2] ...):\n${passages
          .map((p) => `[${p.id}] ${p.title} — ${p.text}`)
          .join("\n")}`
      : "";

  const messages: ChatMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}${knowledgeBlock}${passagesBlock}${languageLine}` },
    { role: "user", content: buildUserContext(text, state, input.history) },
  ];

  const toolCalls: string[] = [];
  const observedOrderIds = new Set<string>();
  const observedCouriers = new Set<string>();
  const observedTrackingRefs = new Set<string>();
  let understanding: AgentUnderstanding | null = null;
  let steps = 0;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    steps = step + 1;
    const message = await ollamaChat(messages, fetchImpl);
    if (!message) return null;

    const calls = normalizeToolCalls(message.tool_calls);
    if (calls.length === 0) {
      // The model answered conversationally without the required structured
      // step. We never trust free-form output, so abandon the agent path.
      return null;
    }

    messages.push({ role: "assistant", content: message.content ?? "", tool_calls: calls });

    for (const call of calls) {
      const name = call.function.name as AgentToolName;
      const args = safeArgs(call.function.arguments);
      toolCalls.push(name);

      const result = executeAgentTool(name, args, { repo, now });
      messages.push({ role: "tool", tool_name: name, content: JSON.stringify(result) });

      const data = (result.data ?? {}) as {
        order?: { id?: string; courier?: string | null; tracking_ref?: string | null };
        order_id?: string;
      };
      if (data.order?.id) observedOrderIds.add(data.order.id);
      if (data.order_id) observedOrderIds.add(data.order_id);
      if (data.order?.courier) observedCouriers.add(data.order.courier.toLowerCase());
      if (data.order?.tracking_ref) observedTrackingRefs.add(data.order.tracking_ref.toUpperCase());

      if (name === "submit_understanding") {
        understanding = parseUnderstanding(args);
      }
    }

    if (understanding) break;
  }

  if (!understanding) return null;

  // Authoritative execution — code, not the model.
  const orchestrator = new ConversationOrchestrator(repo, now);
  const stateForTurn: SessionState = understanding.orderId
    ? { ...state, orderId: understanding.orderId }
    : state;

  let result = orchestrator.processTurn(text, stateForTurn, {
    intent: understanding.intent,
    needsClarification: understanding.needsClarification,
    locale,
    sentiment: understanding.sentiment === "happy" ? "neutral" : understanding.sentiment,
  });

  if (understanding.needsEscalation && result.resolution === "UNRESOLVED") {
    const note = "Escalation requested by the agent.";
    const unresolved = result.unresolved.includes(note)
      ? result.unresolved
      : [...result.unresolved, note];
    result = {
      ...result,
      resolution: "ESCALATION_REQUIRED",
      unresolved,
      state: { ...result.state, resolution: "ESCALATION_REQUIRED", unresolved },
      events: [
        ...result.events,
        agentEvent("Escalation flagged", "A human specialist was recommended.", "warn"),
      ],
    };
  }

  // Optional, tightly-constrained reply composition.
  let acceptedDraft = false;
  let rejectedDraft = false;
  if (understanding.draftReply) {
    const verdict = validateDraft({
      draft: understanding.draftReply,
      result,
      text,
      locale,
      observedOrderIds,
      observedCouriers,
      observedTrackingRefs,
      sourceReply: result.reply,
    });
    if (verdict.accepted) {
      acceptedDraft = true;
      result = {
        ...result,
        reply: understanding.draftReply.trim(),
        events: [
          ...result.events,
          agentEvent(
            "Reply composed by local model",
            `Verified against tool results (confidence ${understanding.confidence.toFixed(2)}).`,
            "ok",
          ),
        ],
      };
    } else {
      rejectedDraft = true;
      result = {
        ...result,
        events: [
          ...result.events,
          agentEvent(
            "Agent draft rejected by guardrail",
            `${verdict.reason}. Used the verified engine reply instead.`,
            "warn",
          ),
        ],
      };
    }
  }

  return {
    result,
    aiUsed: true,
    metrics: {
      steps,
      toolCalls,
      acceptedDraft,
      rejectedDraft,
      understanding,
      citations: passages.map((p) => ({ id: p.id, title: p.title, source: p.source })),
    },
  };
}

/** Exposed for tests and for the client fallback engine. */
export { extractOrderId };
