import { classifyIntent, extractOrderId } from "./intent";
import type { OrderRepository } from "./orders";
import {
  POLICY_COD_LIMIT,
  POLICY_DAMAGE_REPORT_WINDOW_HOURS,
  POLICY_RETURN_WINDOW_DAYS,
  evaluateCancellation,
  evaluateCod,
  evaluateDamagedProduct,
  evaluateReturn,
  evaluateShipping,
} from "./policy";
import { policyReplyKey, t } from "./messages";
import { DEFAULT_LOCALE, type Locale } from "./locale";
import { ToolExecutor, type ToolCallRecord } from "./tools";
import type { CallOutcome } from "./outcome";
import { buildOutcome, type ExecutedAction } from "./outcome";
import type { ClarificationKind, Intent, ResolutionStatus } from "./types";

export interface SessionState {
  pending: ClarificationKind | null;
  orderId: string | null;
  intent: Intent | null;
  resolution: ResolutionStatus | null;
  unresolved: string[];
  actions: ExecutedAction[];
  lastSummary: string | null;
  turnCount: number;
  /** How many times we have asked the same clarification, to avoid loops. */
  clarificationAttempts: number;
}

export function initialSessionState(): SessionState {
  return {
    pending: null,
    orderId: null,
    intent: null,
    resolution: null,
    unresolved: [],
    actions: [],
    lastSummary: null,
    turnCount: 0,
    clarificationAttempts: 0,
  };
}

export type ActivityEventType =
  | "intent_detected"
  | "order_identified"
  | "order_missing"
  | "order_unknown"
  | "order_service_queried"
  | "policy_checked"
  | "result_returned"
  | "clarification_requested"
  | "out_of_scope"
  | "outcome_finalized";

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  label: string;
  detail: string;
  at: string;
  status: "info" | "ok" | "warn" | "error";
}

export interface TurnResult {
  reply: string;
  intent: Intent;
  orderId: string | null;
  resolution: ResolutionStatus;
  summary: string;
  unresolved: string[];
  events: ActivityEvent[];
  toolCalls: ToolCallRecord[];
  policyExplanation: string | null;
  pending: ClarificationKind | null;
  state: SessionState;
  executed: boolean;
}

/** Lightweight, deterministic reading of the customer's tone. */
export type Sentiment = "neutral" | "frustrated" | "confused";

const FRUSTRATED_PATTERNS: RegExp[] = [
  /\b(?:angry|furious|annoyed|frustrat\w*|ridiculous|unacceptable|terrible|awful|worst)\b/i,
  /\b(?:still|again|twice|three times)\b/i,
  /\b(?:useless|waste of time|sick of)\b/i,
  /!{2,}/,
  /(?:नाराज़|गुस्सा|परेशान|बकवास|बेकार|फिर भी|अभी तक)/,
  /(?:বিরক্ত|রাগ|অবিশ্বাস্য|আবারও|এখনও)/,
  /(?:கோபம்|எரிச்சல்|மீண்டும்|இன்னும்)/,
  /(?:राग|त्रास|पुन्हा|अजूनही)/,
];

const CONFUSED_PATTERNS: RegExp[] = [
  /\b(?:confus\w*|not sure|don'?t understand|unclear|which one|what do you mean)\b/i,
  /\?{2,}/,
  /(?:समझ नहीं|उलझन|कौन सा)/,
  /(?:বুঝতে পারছি না|দ্বিধা)/,
  /(?:புரியவில்லை|குழப்பம்)/,
  /(?:समजत नाही|गोंधळ)/,
];

/** Infer the customer's tone from the utterance alone. Never stores anything. */
export function detectSentiment(rawText: string): Sentiment {
  const text = rawText.trim();
  if (!text) return "neutral";
  if (FRUSTRATED_PATTERNS.some((pattern) => pattern.test(text))) return "frustrated";
  if (CONFUSED_PATTERNS.some((pattern) => pattern.test(text))) return "confused";
  return "neutral";
}

let eventCounter = 0;

/**
 * Deterministic conversation orchestrator.
 *
 * It performs intent recognition, server-side tool execution, policy
 * enforcement and response construction. It is fully synchronous, has no
 * external dependencies, and is shared by the API route and the unit tests.
 */
export class ConversationOrchestrator {
  private readonly tools: ToolExecutor;

  constructor(
    private readonly repo: OrderRepository,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.tools = new ToolExecutor(repo, now);
  }

  private event(
    type: ActivityEventType,
    label: string,
    detail: string,
    status: ActivityEvent["status"] = "info",
    at?: string,
  ): ActivityEvent {
    eventCounter += 1;
    return {
      id: `evt_${eventCounter.toString(36)}_${Date.now().toString(36)}`,
      type,
      label,
      detail,
      status,
      at: at ?? this.now().toISOString(),
    };
  }

  /** The spoken opening line, produced without any user input. */
  greeting(locale: Locale = DEFAULT_LOCALE): string {
    return t(locale, "greeting");
  }

  processTurn(
    text: string,
    state: SessionState,
    /**
     * Optional classification override. Used by the optional local-AI adapter:
     * a local model may *propose* an intent, but this orchestrator still
     * enforces every policy decision in code.
     */
    override?: {
      intent?: Intent;
      needsClarification?: ClarificationKind | null;
      locale?: Locale;
      sentiment?: Sentiment;
    },
  ): TurnResult {
    const locale: Locale = override?.locale ?? DEFAULT_LOCALE;
    const sentiment: Sentiment = override?.sentiment ?? detectSentiment(text);
    const events: ActivityEvent[] = [];
    const toolCalls: ToolCallRecord[] = [];
    const next: SessionState = {
      ...state,
      unresolved: [...state.unresolved],
      actions: [...state.actions],
      turnCount: state.turnCount + 1,
    };

    const classification = classifyIntent(text);
    const needsClarification =
      override?.needsClarification ?? classification.needsClarification;
    // Ambiguity means we must not run any action: route to the clarifying path.
    const intent =
      needsClarification === "order_action"
        ? "UNKNOWN"
        : override?.intent ?? classification.intent;

    // Resolve the order id for this turn, preferring a fresh mention.
    const mentioned = classification.orderId ?? extractOrderId(text);
    if (mentioned) {
      next.orderId = mentioned;
    }

    events.push(
      this.event(
        "intent_detected",
        "Customer intent detected",
        `${intent}${classification.signals.length ? ` · ${classification.signals.join(", ")}` : ""}`,
        "info",
      ),
    );

    const orderId = next.orderId;
    if (orderId) {
      events.push(
        this.event("order_identified", "Order identified", `Order id ${orderId}`, "info"),
      );
    }

    let reply = "";
    let resolution: ResolutionStatus = "UNRESOLVED";
    let policyExplanation: string | null = null;
    let summary = next.lastSummary ?? "";
    let pending: ClarificationKind | null = null;
    let executed = false;
    let recordedIntent = intent;

    const askForOrderId = (lead: string): void => {
      reply = `${lead} ${t(locale, "askSuffix")}`;
      pending = "order_id";
      resolution = "UNRESOLVED";
      next.pending = "order_id";
      next.clarificationAttempts += 1;
      events.push(
        this.event(
          "order_missing",
          "Order id requested",
          "No order id supplied; Aria asked the customer to provide one.",
          "warn",
        ),
      );
      events.push(
        this.event("clarification_requested", "Clarifying question", "Requested order id", "info"),
      );
    };

    const handleUnknownOrder = (): void => {
      reply = t(locale, "orderUnknown");
      pending = "verify_order_id";
      resolution = "UNRESOLVED";
      next.pending = "verify_order_id";
      events.push(
        this.event(
          "order_unknown",
          "Order not found",
          `${orderId} is not in the mock dataset.`,
          "error",
        ),
      );
      events.push(
        this.event("clarification_requested", "Clarifying question", "Asked customer to verify the order id", "info"),
      );
    };

    switch (intent) {
      case "CANCELLATION_REQUEST": {
        if (!orderId) {
          askForOrderId(t(locale, "leadCancel"));
          break;
        }
        const lookup = this.tools.lookupOrder(orderId);
        toolCalls.push(lookup.call);
        events.push(this.event("order_service_queried", "Order service queried", lookup.call.summary, lookup.result.ok ? "ok" : "error"));
        if (!lookup.result.ok || !lookup.result.data) {
          handleUnknownOrder();
          break;
        }
        const order = lookup.result.data;

        const alreadyCancelled = next.actions.some(
          (a) => a.type === "CANCELLATION" && a.orderId === order.id && a.status === "executed",
        );
        if (alreadyCancelled) {
          reply = t(locale, "cancelAlready", { orderId: order.id });
          resolution = "RESOLVED";
          events.push(
            this.event("result_returned", "Duplicate action ignored", "Cancellation was already executed for this order.", "warn"),
          );
          break;
        }

        const decision = evaluateCancellation(order);
        events.push(
          this.event("policy_checked", "Policy eligibility checked", decision.detail, decision.status === "allowed" ? "ok" : "warn"),
        );

        if (decision.status === "allowed") {
          const updated = this.repo.setStatus(order.id, "Cancelled");
          const succeeded = updated?.status === "Cancelled";
          if (succeeded) {
            executed = true;
            next.actions.push({
              id: `act_${Date.now().toString(36)}`,
              type: "CANCELLATION",
              orderId: order.id,
              status: "executed",
              detail: "Order cancelled while in Processing.",
              at: this.now().toISOString(),
            });
            reply = t(locale, "cancelOk", { orderId: order.id });
            resolution = "RESOLVED";
            summary =
              `Customer asked to cancel ${order.id}. The order was in Processing, ` +
              `so the cancellation policy allowed it and the order was cancelled.`;
            events.push(
              this.event("result_returned", "Cancellation completed", `${order.id} status set to Cancelled.`, "ok"),
            );
          } else {
            reply = t(locale, "cancelFail", { orderId: order.id });
            resolution = "ESCALATION_REQUIRED";
            if (!next.unresolved.includes("Mock cancellation operation failed.")) {
              next.unresolved.push("Mock cancellation operation failed.");
            }
            events.push(
              this.event("result_returned", "Cancellation failed", "Mock operation did not succeed.", "error"),
            );
          }
        } else {
          const doorstep =
            order.status === "Shipped" || order.status === "Out for Delivery";
          const key = policyReplyKey({
            kind: "cancellation",
            status: decision.status,
            rule: decision.rule,
            doorstep,
          });
          reply = key ? t(locale, key, { status: order.status }) : decision.detail;
          policyExplanation = decision.detail;
          resolution = "UNRESOLVED";
          summary =
            `Customer asked to cancel ${order.id}. The order is currently ` +
            `${order.status}, so the cancellation policy did not allow it.`;
          next.actions.push({
            id: `act_${Date.now().toString(36)}`,
            type: "CANCELLATION",
            orderId: order.id,
            status: "blocked",
            detail: decision.detail,
            at: this.now().toISOString(),
          });
          if (!next.unresolved.includes(`Cancellation blocked for ${order.id}: ${decision.detail}`)) {
            next.unresolved.push(`Cancellation blocked for ${order.id}.`);
          }
          events.push(
            this.event("result_returned", "Cancellation not permitted", decision.detail, "warn"),
          );
        }
        break;
      }

      case "RETURN_REQUEST": {
        if (!orderId) {
          reply = t(locale, "returnNeedOrder");
          pending = "order_id";
          resolution = "UNRESOLVED";
          next.pending = "order_id";
          events.push(
            this.event("policy_checked", "Return policy explained", "General seven-day return policy shared.", "info"),
          );
          events.push(this.event("clarification_requested", "Clarifying question", "Requested order id", "info"));
          break;
        }
        const lookup = this.tools.lookupOrder(orderId);
        toolCalls.push(lookup.call);
        events.push(this.event("order_service_queried", "Order service queried", lookup.call.summary, lookup.result.ok ? "ok" : "error"));
        if (!lookup.result.ok || !lookup.result.data) {
          handleUnknownOrder();
          break;
        }
        const order = lookup.result.data;
        const decision = evaluateReturn({ deliveredDaysAgo: order.deliveredDaysAgo });
        events.push(
          this.event("policy_checked", "Return policy checked", decision.detail, decision.status === "allowed" ? "ok" : "warn"),
        );

        if (decision.status === "allowed") {
          executed = true;
          next.actions.push({
            id: `act_${Date.now().toString(36)}`,
            type: "RETURN_REQUEST",
            orderId: order.id,
            status: "executed",
            detail: "Return request logged within policy window.",
            at: this.now().toISOString(),
          });
          reply = t(locale, "returnOk", { orderId: order.id });
          resolution = "RESOLVED";
          summary = `Customer requested a return for ${order.id}. The order is within the seven-day window, so a return request was logged.`;
        } else {
          const key = policyReplyKey({
            kind: "return",
            status: decision.status,
            rule: decision.rule,
          });
          reply = key
            ? t(locale, key, {
                window: POLICY_RETURN_WINDOW_DAYS,
                days: order.deliveredDaysAgo ?? 0,
              })
            : decision.detail;
          policyExplanation = decision.detail;
          resolution = "UNRESOLVED";
          summary =
            `Customer requested a return for ${order.id}. The return policy ` +
            `did not allow it (${decision.status}).`;
          next.actions.push({
            id: `act_${Date.now().toString(36)}`,
            type: "RETURN_REQUEST",
            orderId: order.id,
            status: "blocked",
            detail: decision.detail,
            at: this.now().toISOString(),
          });
          if (!next.unresolved.includes(`Return not available for ${order.id}.`)) {
            next.unresolved.push(`Return not available for ${order.id}.`);
          }
          events.push(this.event("result_returned", "Return not permitted", decision.detail, "warn"));
        }
        break;
      }

      case "DAMAGED_PRODUCT": {
        if (!orderId) {
          askForOrderId(t(locale, "leadDamage"));
          break;
        }
        const lookup = this.tools.lookupOrder(orderId);
        toolCalls.push(lookup.call);
        events.push(this.event("order_service_queried", "Order service queried", lookup.call.summary, lookup.result.ok ? "ok" : "error"));
        if (!lookup.result.ok || !lookup.result.data) {
          handleUnknownOrder();
          break;
        }
        const order = lookup.result.data;
        const hasPhotos =
          /\bphoto(?:s)?\b/.test(text.toLowerCase()) ||
          /\bpicture/.test(text.toLowerCase()) ||
          /\bimage/.test(text.toLowerCase()) ||
          /\battach/.test(text.toLowerCase());
        const decision = evaluateDamagedProduct({
          deliveredDaysAgo: order.deliveredDaysAgo,
          hasPhotos,
        });
        events.push(
          this.event("policy_checked", "Damaged-product policy checked", decision.detail, decision.status === "allowed" ? "ok" : "warn"),
        );
        policyExplanation = decision.status === "allowed" ? null : decision.detail;
        const damageKey = policyReplyKey({
          kind: "damage",
          status: decision.status,
          rule: decision.rule,
        });
        reply = damageKey
          ? t(locale, damageKey, {
              window: POLICY_DAMAGE_REPORT_WINDOW_HOURS,
              hours: (order.deliveredDaysAgo ?? 0) * 24,
            })
          : decision.detail;
        resolution =
          decision.status === "allowed" ? "RESOLVED" : decision.status === "denied" ? "UNRESOLVED" : "UNRESOLVED";
        if (decision.status === "allowed") {
          executed = true;
          next.actions.push({
            id: `act_${Date.now().toString(36)}`,
            type: "DAMAGE_REPORT",
            orderId: order.id,
            status: "executed",
            detail: "Replacement request raised with photos.",
            at: this.now().toISOString(),
          });
        } else {
          next.actions.push({
            id: `act_${Date.now().toString(36)}`,
            type: "DAMAGE_REPORT",
            orderId: order.id,
            status: "not_executed",
            detail: decision.detail,
            at: this.now().toISOString(),
          });
          if (!next.unresolved.includes(`Damaged-product claim not completed for ${order.id}.`)) {
            next.unresolved.push(`Damaged-product claim not completed for ${order.id}.`);
          }
        }
        summary = `Customer reported an issue with ${order.id}. ${decision.detail}`;
        events.push(this.event("result_returned", "Damaged-product policy returned", decision.detail, decision.status === "allowed" ? "ok" : "warn"));
        break;
      }

      case "COD_QUERY": {
        if (orderId) {
          const lookup = this.tools.lookupOrder(orderId);
          toolCalls.push(lookup.call);
          events.push(this.event("order_service_queried", "Order service queried", lookup.call.summary, lookup.result.ok ? "ok" : "error"));
          if (lookup.result.ok && lookup.result.data) {
            const decision = evaluateCod(lookup.result.data.value);
            events.push(this.event("policy_checked", "COD policy checked", decision.detail, decision.status === "allowed" ? "ok" : "warn"));
            const codKey = policyReplyKey({ kind: "cod", status: decision.status, rule: decision.rule });
            reply = codKey
              ? t(locale, codKey, {
                  limit: POLICY_COD_LIMIT.toLocaleString("en-IN"),
                  value: lookup.result.data.value.toLocaleString("en-IN"),
                })
              : decision.detail;
            resolution = "RESOLVED";
            summary = `Customer asked about Cash on Delivery for ${lookup.result.data.id}. ${decision.detail}`;
            next.actions.push({
              id: `act_${Date.now().toString(36)}`,
              type: "COD_CHECK",
              orderId: lookup.result.data.id,
              status: decision.status === "allowed" ? "executed" : "not_executed",
              detail: decision.detail,
              at: this.now().toISOString(),
            });
            events.push(this.event("result_returned", "COD policy returned", decision.detail, "ok"));
            break;
          }
        }
        reply = t(locale, "codGeneral");
        resolution = "RESOLVED";
        summary = "Customer asked about Cash on Delivery. General COD policy shared.";
        events.push(this.event("policy_checked", "COD policy explained", "COD up to ₹2,500 by cash or UPI at doorstep.", "ok"));
        break;
      }

      case "SHIPPING_QUERY": {
        if (orderId) {
          const lookup = this.tools.lookupOrder(orderId);
          toolCalls.push(lookup.call);
          events.push(this.event("order_service_queried", "Order service queried", lookup.call.summary, lookup.result.ok ? "ok" : "error"));
          if (lookup.result.ok && lookup.result.data) {
          const quote = evaluateShipping(lookup.result.data.value);
          events.push(this.event("policy_checked", "Shipping policy checked", quote.detail, quote.status === "allowed" ? "ok" : "warn"));
          if (quote.status === "boundary") {
            reply = t(locale, "shippingBoundary");
          } else if (quote.status === "allowed" && quote.freeDelivery === true) {
            reply = t(locale, "shippingFree");
          } else if (quote.status === "allowed" && quote.freeDelivery === false) {
            reply = t(locale, "shippingBelow");
          } else {
            reply = quote.detail;
          }
            resolution = "RESOLVED";
            policyExplanation = quote.status === "boundary" ? quote.detail : null;
            summary = `Customer asked about shipping for ${lookup.result.data.id}. ${quote.detail}`;
            next.actions.push({
              id: `act_${Date.now().toString(36)}`,
              type: "SHIPPING_CHECK",
              orderId: lookup.result.data.id,
              status: "executed",
              detail: quote.detail,
              at: this.now().toISOString(),
            });
            events.push(this.event("result_returned", "Shipping policy returned", quote.detail, "ok"));
            break;
          }
          if (!lookup.result.ok) {
            handleUnknownOrder();
            break;
          }
        }
        reply = t(locale, "shippingGeneral");
        resolution = "RESOLVED";
        summary = "Customer asked about shipping charges. General shipping policy shared, including the unresolved exactly-₹499 boundary.";
        events.push(this.event("policy_checked", "Shipping policy explained", "Free above ₹499, ₹50 below ₹499, 3–5 business days; ₹499 boundary unresolved.", "ok"));
        break;
      }

      case "ORDER_TRACKING": {
        if (!orderId) {
          askForOrderId(t(locale, "leadTrack"));
          break;
        }
        const lookup = this.tools.lookupOrder(orderId);
        toolCalls.push(lookup.call);
        events.push(this.event("order_service_queried", "Order service queried", lookup.call.summary, lookup.result.ok ? "ok" : "error"));
        if (!lookup.result.ok || !lookup.result.data) {
          handleUnknownOrder();
          break;
        }
        const order = lookup.result.data;
        const parts: string[] = [];
        parts.push(
          t(locale, "trackingStatus", {
            orderId: order.id,
            customerName: order.customerName,
            status: order.status,
          }),
        );
        if (order.courier && order.trackingRef) {
          parts.push(
            t(locale, "trackingCourier", {
              courier: order.courier,
              ref: order.trackingRef,
            }),
          );
        } else {
          parts.push(t(locale, "trackingNoCourier"));
          const note = "No courier or tracking data was supplied for this order.";
          if (!next.unresolved.includes(note)) next.unresolved.push(note);
        }
        parts.push(t(locale, "trackingNote", { note: order.supplierNote }));
        parts.push(t(locale, "trackingMock"));
        reply = parts.join(" ");
        resolution = "RESOLVED";
        summary =
          `Customer asked about ${order.id}. The supplied mock data indicates ` +
          `that the order is ${order.status.toLowerCase()}` +
          (order.supplierNote ? `, with the note: ${order.supplierNote}.` : ".");
        next.actions.push({
          id: `act_${Date.now().toString(36)}`,
          type: "ORDER_LOOKUP",
          orderId: order.id,
          status: "executed",
          detail: `Status ${order.status}. ${order.supplierNote}`,
          at: this.now().toISOString(),
        });
        events.push(this.event("result_returned", "Order details returned", `${order.id}: ${order.status}`, "ok"));
        break;
      }

      case "GENERAL_PRODUCT_QUERY": {
        reply = t(locale, "productDeclined");
        resolution = "ESCALATION_REQUIRED";
        recordedIntent = "GENERAL_PRODUCT_QUERY";
        if (!next.unresolved.includes("Product catalogue details requested but unavailable in this demo.")) {
          next.unresolved.push("Product catalogue details requested but unavailable in this demo.");
        }
        next.actions.push({
          id: `act_${Date.now().toString(36)}`,
          type: "INFO_ONLY",
          orderId: null,
          status: "not_executed",
          detail: "Product catalogue question requires a human specialist.",
          at: this.now().toISOString(),
        });
        events.push(
          this.event("result_returned", "No catalogue available", "Declined to invent product details.", "warn"),
        );
        break;
      }

      case "OUT_OF_SCOPE": {
        reply = t(locale, "outOfScope");
        resolution = "OUT_OF_SCOPE";
        summary = "Customer asked something outside Aura Skincare support; politely declined.";
        events.push(this.event("out_of_scope", "Request out of scope", "Politely declined a non-Aura request.", "warn"));
        break;
      }

      case "UNKNOWN":
      default: {
        const lc = text.toLowerCase().trim();
        const isGreeting =
          /^(hi|hello|hey|namaste|good (morning|afternoon|evening))\b/.test(lc) ||
          /(नमस्ते|नमस्कार|হ্যালো|নমস্কার|வணக்கம்)/.test(text);

        if (needsClarification === "order_action") {
          reply = t(locale, "clarifyOrderAction");
          pending = "order_action";
          resolution = "UNRESOLVED";
          summary = "Customer referred to their order without a clear action; Aria asked whether they want to track, cancel or return.";
          events.push(this.event("clarification_requested", "Clarifying question", "Asked track / cancel / return.", "info"));
          break;
        }

        if (isGreeting) {
          reply = t(locale, "unknownGreeting");
          resolution = "UNRESOLVED";
          summary = "Customer greeted Aria; Aria offered the supported help topics.";
          break;
        }

        reply = t(locale, "unknownRephrase");
        resolution = "UNRESOLVED";
        summary = "Aria could not confidently classify the request and asked the customer to rephrase.";
        events.push(this.event("clarification_requested", "Clarifying question", "Asked customer to rephrase.", "warn"));
        break;
      }
    }

    if (!summary) {
      summary = next.lastSummary ?? "No summary available.";
    }

    // Tone-aware framing. Empathy is added only when the outcome was not a clean
    // resolution, so a calm, successful answer stays concise. The policy text
    // itself is never altered — the prefix is purely conversational.
    if (sentiment === "frustrated" && resolution !== "RESOLVED" && intent !== "OUT_OF_SCOPE") {
      reply = `${t(locale, "empathyFrustrated")} ${reply}`;
    } else if (sentiment === "confused" && resolution === "UNRESOLVED" && pending) {
      reply = `${t(locale, "empathyConfused")} ${reply}`;
    }

    next.intent = recordedIntent;
    next.resolution = resolution;
    next.lastSummary = summary;
    next.pending = pending;

    return {
      reply,
      intent: recordedIntent,
      orderId: next.orderId,
      resolution,
      summary,
      unresolved: next.unresolved,
      events,
      toolCalls,
      policyExplanation,
      pending,
      state: next,
      executed,
    };
  }

  /** Finalise the session into a validated outcome. */
  buildOutcome(
    state: SessionState,
    mode: CallOutcome["mode"],
  ): CallOutcome {
    return buildOutcome(
      {
        intent: state.intent ?? "UNKNOWN",
        orderId: state.orderId,
        resolution: state.resolution ?? "UNRESOLVED",
        summary: state.lastSummary ?? "No summary could be generated for this call.",
        actions: state.actions,
        unresolved: state.unresolved,
        mode,
      },
      this.now,
    );
  }

  finalizeEvent(at?: string): ActivityEvent {
    return this.event(
      "outcome_finalized",
      "Call outcome finalized",
      "Transcript, actions and resolution captured.",
      "ok",
      at,
    );
  }
}
