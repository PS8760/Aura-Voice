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
  /** Weighted runner-up intents, exposed for auditability and the admin portal. */
  alternatives: { intent: Intent; score: number }[];
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
 * Multilingual keywords for the non-English locales (Hindi, Bengali, Tamil,
 * Marathi) plus romanised (transliterated) forms. Phrase-level English still
 * routes through the regexes below; these give a deterministic first pass when
 * the utterance is not written in English or is typed in Latin letters.
 *
 * A signal can only *add* weight; the authoritative policy checks are unchanged.
 */
const ML_ORDER = ["ऑर्डर", "आदेश", "অর্ডার", "ஆர்டர்", "aadesh"];
const ML_CANCEL = ["रद्द", "कैंसिल", "बातिल", "বাতিল", "রদ", "ரத்து", "விலக்கு", "radd", "radh"];
const ML_RETURN = ["वापस", "रिटर्न", "ফেরত", "திருப்ப", "திரும்ப", "परत", "परताव", "wapas", "wapasi"];
const ML_DAMAGE = [
  "खराब",
  "टूट",
  "क्षतिग्रस्त",
  "নষ্ট",
  "ভাঙ",
  "ক্ষতিগ্রস্ত",
  "சேத",
  "உடைந்த",
  "கெட்ட",
  "तुट",
  "नुकसान",
  "kharab",
  "kharaab",
  "tuta",
  "toota",
];
const ML_COD = [
  "कैश ऑन डिलीवरी",
  "कॅश ऑन डिलिव्हरी",
  "नकद",
  "নগদ",
  "ক্যাশ অন",
  "கேஷ்",
  "பணம்",
  "रोख",
  "nagad",
  "nakad",
];
const ML_SHIPPING = [
  "शिपिंग",
  "शिपिंग शुल्क",
  "डिलिव्हरी शुल्क",
  "শিপিং",
  "ডেলিভারি চার্জ",
  "ஷிப்பிங்",
  "டெலிவரி கட்டணம்",
  "shipping charge",
];
const ML_TRACK = [
  "ट्रैक",
  "ट्रॅक",
  "स्थिति",
  "स्थिती",
  "कहाँ",
  "कहां",
  "कुठे",
  "ট্র্যাক",
  "অবস্থা",
  "কোথায়",
  "கண்காணி",
  "நிலை",
  "எங்கே",
  "kahan",
  "kab",
];
const ML_HELP = ["मदद", "सहायता", "সাহায্য", "உதவி", "मदत", "madad"];

/**
 * Negation tokens. When one appears immediately before an action keyword, the
 * action is suppressed — e.g. "I don't want to cancel" must not be read as a
 * cancellation request.
 */
const NEGATIONS = [
  "not",
  "don't",
  "dont",
  "do not",
  "never",
  "no ",
  "नहीं",
  "नही",
  "नको",
  "नका",
  "না",
  "নয়",
  "இல்லை",
  "வேண்டாம்",
  "नाही",
  "nahi",
  "mat ",
];

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

/** Index of the first matching substring, or -1. */
function findSubstr(text: string, needles: string[]): number {
  let best = -1;
  for (const needle of needles) {
    const at = text.indexOf(needle);
    if (at !== -1 && (best === -1 || at < best)) best = at;
  }
  return best;
}

/** Index of the first matching RegExp, or -1. */
function findPattern(text: string, patterns: RegExp[]): number {
  let best = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && (best === -1 || match.index < best)) best = match.index;
  }
  return best;
}

/** True when a negation token appears shortly before the given index. */
function isNegated(text: string, index: number, window = 28): boolean {
  if (index < 0) return false;
  const before = text.slice(Math.max(0, index - window), index);
  return NEGATIONS.some((negation) => before.includes(negation));
}

/**
 * Extract an order reference from free text. Returns canonical "ORD-101" form.
 * Handles "ORD-101", "ord 101", "order#101", "ORD101" and, when paired with
 * order vocabulary, a bare three-digit number.
 */
export function extractOrderId(text: string): string | null {
  const match = /\b(?:ord|order|आर्डर)\s*[-#]?\s*(\d{1,4})\b/i.exec(text);
  if (match) return canonicalOrderId(match[1]);

  // A bare number is only treated as an order id when paired with intent words.
  const bare = /\b(\d{3})\b/.exec(text);
  if (
    bare &&
    (/\b(order|track|cancel|return|cod|delivery|status|parcel|package)\b/i.test(text) ||
      hasAny(text, [...ML_ORDER, ...ML_CANCEL, ...ML_RETURN, ...ML_TRACK]))
  ) {
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

/* -------------------------------------------------------- weighted evidence */

type Evidence = { intent: Intent; weight: number; label: string };

/**
 * Weighted, auditable signal extraction.
 *
 * Each intent accumulates evidence from English regexes, multilingual keywords
 * and romanised forms. Negated actions are dropped. The outcome is a scored
 * ranking rather than a first-match rule, so confidence can reflect how much
 * (and how cleanly) the utterance supports the winning intent.
 */
function collectEvidence(text: string): { evidence: Evidence[]; productQuery: string | null } {
  const evidence: Evidence[] = [];

  if (OUT_OF_SCOPE_PATTERNS.some((p) => p.test(text))) {
    evidence.push({ intent: "OUT_OF_SCOPE", weight: 1.5, label: "out-of-scope topic" });
  }

  const cancelAt = findPattern(text, [
    /\bcancel(?:led|lation|ling)?\b/,
    /\bcall (?:it|the order) off\b/,
  ]);
  const cancelSub = cancelAt === -1 ? findSubstr(text, ML_CANCEL) : cancelAt;
  const cancelNegated = cancelSub !== -1 && isNegated(text, cancelSub);
  if (cancelSub !== -1 && !cancelNegated) {
    evidence.push({ intent: "CANCELLATION_REQUEST", weight: 1.3, label: "cancel keyword" });
  }
  if (/\bdon'?t want\b/.test(text) && !/\bdon'?t want to (?:cancel|return)\b/.test(text)) {
    evidence.push({ intent: "CANCELLATION_REQUEST", weight: 1.0, label: "\"don't want\" phrase" });
  }

  const damageAt = findPattern(text, [
    /\bdamag(?:e|ed)\b/,
    /\bbroken\b/,
    /\bdefective\b/,
    /\bleak(?:ing|ed)?\b/,
    /\bspoiled\b/,
    /\bsmashed\b/,
  ]);
  const damageSub = damageAt === -1 ? findSubstr(text, ML_DAMAGE) : damageAt;
  if (damageSub !== -1 && !isNegated(text, damageSub)) {
    evidence.push({ intent: "DAMAGED_PRODUCT", weight: 1.4, label: "damage keyword" });
  }

  const returnAt = findPattern(text, [
    /\breturn(?:s|ing|ed)?\b/,
    /\brefund(?:s|ing|ed)?\b/,
    /\bsend (?:it )?back\b/,
    /\bexchange\b/,
  ]);
  const returnSub = returnAt === -1 ? findSubstr(text, ML_RETURN) : returnAt;
  if (returnSub !== -1 && !isNegated(text, returnSub)) {
    evidence.push({ intent: "RETURN_REQUEST", weight: 1.3, label: "return keyword" });
  }

  const codAt = findPattern(text, [
    /\bcod\b/,
    /cash on delivery/,
    /\bpay on delivery\b/,
    /upi at (?:the )?doorstep/,
    /\bcash\b/,
  ]);
  const codSub = codAt === -1 ? findSubstr(text, ML_COD) : codAt;
  if (codSub !== -1 && !isNegated(text, codSub)) {
    evidence.push({ intent: "COD_QUERY", weight: 1.2, label: "COD keyword" });
  }

  const shippingAt = findPattern(text, [
    /\bshipping\b/,
    /\bdelivery (?:charge|charges|fee|cost|price)\b/,
    /\b(?:charge|charges|fee|cost) for (?:delivery|shipping)\b/,
    /\bfree (?:delivery|shipping)\b/,
    /\bhow many days\b/,
  ]);
  let shippingSub = shippingAt === -1 ? findSubstr(text, ML_SHIPPING) : shippingAt;
  if (shippingSub === -1 && /\bhow much\b/.test(text) && /\b(?:deliver|ship)/.test(text)) {
    shippingSub = text.indexOf("how much");
  }
  if (shippingSub === -1 && /\bhow long (?:does|will)\b/.test(text) && /\b(?:deliver|ship)/.test(text)) {
    shippingSub = text.indexOf("how long");
  }
  if (shippingSub !== -1 && !isNegated(text, shippingSub)) {
    evidence.push({ intent: "SHIPPING_QUERY", weight: 1.1, label: "shipping keyword" });
  }

  const trackingAt = findPattern(text, [
    /\btrack(?:ing)?\b/,
    /\bwhere(?:'s| is| are)\b/,
    /\bstatus\b/,
    /\bwhen (?:will|does)\b/,
    /\bdid (?:it|my order) (?:arrive|ship|dispatch)\b/,
    /\bpackage\b/,
    /\bparcel\b/,
    /\bshipment\b/,
  ]);
  const trackingSub = trackingAt === -1 ? findSubstr(text, ML_TRACK) : trackingAt;
  if (trackingSub !== -1 && !isNegated(text, trackingSub)) {
    evidence.push({ intent: "ORDER_TRACKING", weight: 1.2, label: "tracking keyword" });
  }

  const productQuery = includesAny(text, PRODUCT_KEYWORDS);
  if (productQuery) {
    evidence.push({
      intent: "GENERAL_PRODUCT_QUERY",
      weight: 0.9,
      label: `product keyword "${productQuery}"`,
    });
  }

  // An explicit order reference is weak corroboration for order-centric intents.
  if (extractOrderId(text)) {
    for (const intent of ["ORDER_TRACKING", "CANCELLATION_REQUEST", "RETURN_REQUEST", "DAMAGED_PRODUCT"] as const) {
      evidence.push({ intent, weight: 0.15, label: "order id present" });
    }
  }

  return { evidence, productQuery };
}

const PRECEDENCE: Intent[] = [
  "OUT_OF_SCOPE",
  "DAMAGED_PRODUCT",
  "CANCELLATION_REQUEST",
  "RETURN_REQUEST",
  "COD_QUERY",
  "ORDER_TRACKING",
  "SHIPPING_QUERY",
  "GENERAL_PRODUCT_QUERY",
  "UNKNOWN",
];

/**
 * Deterministic, scored intent classifier.
 *
 * It remains simple and auditable, but ranks weighted evidence instead of
 * taking the first matching rule. When Ollama is enabled the local model may
 * *propose* an intent, but this classifier stays the source of truth for
 * routing and policy decisions.
 */
export function classifyIntent(rawText: string): IntentResult {
  const text = rawText.trim().toLowerCase();

  if (!text) {
    return {
      intent: "UNKNOWN",
      orderId: null,
      confidence: 0,
      signals: ["empty utterance"],
      needsClarification: null,
      productQuery: null,
      alternatives: [],
    };
  }

  const orderId = extractOrderId(rawText);
  const { evidence, productQuery } = collectEvidence(text);

  const totals = new Map<Intent, number>();
  for (const item of evidence) {
    totals.set(item.intent, (totals.get(item.intent) ?? 0) + item.weight);
  }

  const ranked = [...totals.entries()]
    .map(([intent, score]) => ({ intent, score }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return PRECEDENCE.indexOf(a.intent) - PRECEDENCE.indexOf(b.intent);
    });

  const signals = evidence.map((item) => item.label);
  if (orderId) signals.unshift(`order id ${orderId}`);

  const winner = ranked[0] ?? null;
  const runnerUp = ranked[1] ?? null;

  let intent: Intent = winner?.intent ?? "UNKNOWN";
  let confidence = 0;
  const scoreMargin = winner ? winner.score - (runnerUp?.score ?? 0) : 0;

  if (winner) {
    confidence = Math.min(
      0.97,
      0.58 + 0.11 * Math.min(winner.score, 3) + 0.07 * Math.min(scoreMargin, 2),
    );
  }

  // Ambiguity: the customer refers to an order with an action-less question.
  const mentionsOrder =
    /\border\b/.test(text) ||
    /\bdelivery\b/.test(text) ||
    /\bparcel\b/.test(text) ||
    /\bshipment\b/.test(text) ||
    /\bpackage\b/.test(text) ||
    hasAny(text, ML_ORDER);
  const asksForHelp =
    /\bhelp\b/.test(text) ||
    /\bissue\b/.test(text) ||
    /\bproblem\b/.test(text) ||
    /\bquestion\b/.test(text) ||
    /\bquery\b/.test(text) ||
    hasAny(text, ML_HELP);

  let needsClarification: ClarificationKind | null = null;
  if (mentionsOrder && asksForHelp && intent === "UNKNOWN") {
    needsClarification = "order_action";
    signals.push("ambiguous order query");
    confidence = 0.5;
  }

  // Abstention: two action intents scored too close to call (e.g. "I want to
  // cancel and return it"). Rather than guess — and risk executing the wrong
  // destructive action — Aria asks the customer to disambiguate.
  const ACTION_INTENTS: Intent[] = [
    "CANCELLATION_REQUEST",
    "RETURN_REQUEST",
    "DAMAGED_PRODUCT",
    "ORDER_TRACKING",
    "COD_QUERY",
    "SHIPPING_QUERY",
  ];
  if (
    !needsClarification &&
    winner &&
    runnerUp &&
    ACTION_INTENTS.includes(intent) &&
    ACTION_INTENTS.includes(runnerUp.intent) &&
    scoreMargin < 0.4 &&
    runnerUp.score >= winner.score * 0.8
  ) {
    needsClarification = "order_action";
    intent = "UNKNOWN";
    signals.push(`ambiguous between ${winner.intent} and ${runnerUp.intent}`);
    confidence = Math.min(confidence, 0.45);
  }

  return {
    intent,
    orderId,
    confidence,
    signals,
    needsClarification,
    productQuery,
    alternatives: ranked.slice(1, 4),
  };
}
