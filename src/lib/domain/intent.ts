import { canonicalOrderId } from "./orders";
import type { ClarificationKind, Intent } from "./types";

export interface IntentResult {
  intent: Intent;
  orderId: string | null;
  /** 0..1 heuristic confidence. Deterministic, not a probability model. */
  confidence: number;
  /** Human-readable signals that matched, exposed for the activity timeline. */
  signals: string[];
  /** Set when Aria should ask a clarifying question instead of guessing. */
  needsClarification: ClarificationKind | null;
  productQuery: string | null;
}

const OUT_OF_SCOPE_PATTERNS: RegExp[] = [
  /\bweather\b/i,
  /\bflight\b/i,
  /\bcricket\b/i,
  /\bstock (price|market)\b/i,
  /\bjoke\b/i,
  /\bmovie\b/i,
  /\bnews\b/i,
  /\bcrypto\b/i,
  /\btell me a story\b/i,
];

const PRODUCT_KEYWORDS = [
  "serum",
  "sunscreen",
  "spf",
  "face wash",
  "toner",
  "moisturiser",
  "moisturizer",
  "ingredients",
  "how to use",
  "skin type",
  "recommend",
  "routine",
  "vitamin c",
  "green tea",
];

/**
 * Extract an order reference from free text. Returns canonical "ORD-101" form.
 */
export function extractOrderId(text: string): string | null {
  const match = /\b(?:ord|order)\s*[-#]?\s*(\d{1,4})\b/i.exec(text);
  if (match) return canonicalOrderId(match[1]);

  // A bare number is only treated as an order id when paired with intent words.
  const bare = /\b(\d{3})\b/.exec(text);
  if (bare && /\b(order|track|cancel|return|cod|delivery|status)\b/i.test(text)) {
    return canonicalOrderId(bare[1]);
  }
  return null;
}

function includesAny(text: string, needles: string[]): string | null {
  for (const needle of needles) {
    if (text.includes(needle)) return needle;
  }
  return null;
}

/**
 * Deterministic intent classifier.
 *
 * It is deliberately simple and auditable. When Ollama is enabled the local
 * model may *propose* an intent, but this classifier remains the source of
 * truth for routing and policy decisions.
 */
export function classifyIntent(rawText: string): IntentResult {
  const text = rawText.trim().toLowerCase();
  const signals: string[] = [];

  if (!text) {
    return {
      intent: "UNKNOWN",
      orderId: null,
      confidence: 0,
      signals: ["empty utterance"],
      needsClarification: null,
      productQuery: null,
    };
  }

  const orderId = extractOrderId(rawText);
  if (orderId) signals.push(`order id ${orderId}`);

  const isCancel =
    /\bcancel(?:led|lation|ling)?\b/.test(text) ||
    /\bdon'?t want\b/.test(text) ||
    /\bcall (?:it|the order) off\b/.test(text);
  if (isCancel) signals.push("cancel keyword");

  const isDamaged =
    /\bdamag(?:e|ed)\b/.test(text) ||
    /\bbroken\b/.test(text) ||
    /\bdefective\b/.test(text) ||
    /\bleak(?:ing|ed)?\b/.test(text) ||
    /\bspoiled\b/.test(text) ||
    /\bsmashed\b/.test(text);
  if (isDamaged) signals.push("damage keyword");

  const isReturn =
    /\breturn(?:s|ing|ed)?\b/.test(text) ||
    /\brefund(?:s|ing|ed)?\b/.test(text) ||
    /\bsend (?:it )?back\b/.test(text) ||
    /\bexchange\b/.test(text);
  if (isReturn) signals.push("return keyword");

  const isCod =
    /\bcod\b/.test(text) ||
    /cash on delivery/.test(text) ||
    /\bpay on delivery\b/.test(text) ||
    /upi at (?:the )?doorstep/.test(text) ||
    /\bcash\b/.test(text);
  if (isCod) signals.push("COD keyword");

  const isShipping =
    /\bshipping\b/.test(text) ||
    /\bdelivery (?:charge|charges|fee|cost|price)\b/.test(text) ||
    /\b(?:charge|charges|fee|cost) for (?:delivery|shipping)\b/.test(text) ||
    /\bfree (?:delivery|shipping)\b/.test(text) ||
    (/\bhow much\b/.test(text) && /\b(?:deliver|ship)/.test(text)) ||
    /\bhow long (?:does|will)\b/.test(text) ||
    /\bhow many days\b/.test(text);
  if (isShipping) signals.push("shipping keyword");

  const isTracking =
    /\btrack(?:ing)?\b/.test(text) ||
    /\bwhere(?:'s| is| are)\b/.test(text) ||
    /\bstatus\b/.test(text) ||
    /\bwhen (?:will|does)\b/.test(text) ||
    /\bdid (?:it|my order) (?:arrive|ship|dispatch)\b/.test(text);
  if (isTracking) signals.push("tracking keyword");

  const productNeedle = includesAny(text, PRODUCT_KEYWORDS);
  if (productNeedle) signals.push(`product keyword "${productNeedle}"`);

  const outOfScope = OUT_OF_SCOPE_PATTERNS.some((p) => p.test(text));
  if (outOfScope) signals.push("out-of-scope topic");

  let intent: Intent = "UNKNOWN";
  let confidence = 0.4;

  if (outOfScope) {
    intent = "OUT_OF_SCOPE";
    confidence = 0.85;
  } else if (isDamaged) {
    intent = "DAMAGED_PRODUCT";
    confidence = 0.9;
  } else if (isCancel) {
    intent = "CANCELLATION_REQUEST";
    confidence = 0.9;
  } else if (isReturn) {
    intent = "RETURN_REQUEST";
    confidence = 0.88;
  } else if (isCod) {
    intent = "COD_QUERY";
    confidence = 0.85;
  } else if (isTracking) {
    intent = "ORDER_TRACKING";
    confidence = 0.85;
  } else if (isShipping) {
    intent = "SHIPPING_QUERY";
    confidence = 0.82;
  } else if (productNeedle) {
    intent = "GENERAL_PRODUCT_QUERY";
    confidence = 0.7;
  }

  // Ambiguity: the customer refers to "my order" with an action-less question.
  const mentionsOrder =
    /\border\b/.test(text) || /\bdelivery\b/.test(text) || /\bparcel\b/.test(text) || /\bshipment\b/.test(text);
  const asksForHelp =
    /\bhelp\b/.test(text) || /\bissue\b/.test(text) || /\bproblem\b/.test(text) || /\bquestion\b/.test(text) || /\bquery\b/.test(text);

  let needsClarification: ClarificationKind | null = null;
  if (mentionsOrder && asksForHelp && intent === "UNKNOWN") {
    needsClarification = "order_action";
    signals.push("ambiguous order query");
    confidence = 0.5;
  }

  return {
    intent,
    orderId,
    confidence,
    signals,
    needsClarification,
    productQuery: productNeedle,
  };
}
