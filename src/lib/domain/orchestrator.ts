import { classifyIntent, extractOrderId } from "./intent";
import type { OrderRepository } from "./orders";
import {
  evaluateCancellation,
  evaluateCod,
  evaluateDamagedProduct,
  evaluateReturn,
  evaluateShipping,
} from "./policy";
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
  greeting(): string {
    return (
      "Thank you for calling Aura Skincare support. This is Aria. I can help " +
      "you track an order, request a cancellation or a return, check shipping " +
      "or Cash on Delivery, or report a damaged product. How can I help you today?"
    );
  }

  processTurn(
    text: string,
    state: SessionState,
    /**
     * Optional classification override. Used by the optional local-AI adapter:
     * a local model may *propose* an intent, but this orchestrator still
     * enforces every policy decision in code.
     */
    override?: { intent?: Intent; needsClarification?: ClarificationKind | null },
  ): TurnResult {
    const events: ActivityEvent[] = [];
    const toolCalls: ToolCallRecord[] = [];
    const next: SessionState = {
      ...state,
      unresolved: [...state.unresolved],
      actions: [...state.actions],
      turnCount: state.turnCount + 1,
    };

    const classification = classifyIntent(text);
    const intent = override?.intent ?? classification.intent;
    const needsClarification =
      override?.needsClarification ?? classification.needsClarification;

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
      reply = `${lead} Could you share the order id, for example ORD-101?`;
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
      reply =
        `I could not find an order with that id in our records. This demo ` +
        `only includes ORD-101, ORD-102 and ORD-103. Could you double-check ` +
        `and share the correct order id?`;
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
          askForOrderId("I can help with a cancellation.");
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
          reply = `ORD-${order.id.split("-")[1]} has already been cancelled in this session, so no further action is needed.`;
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
            reply =
              `Good news — ${order.id} was still Processing, so I have ` +
              `cancelled it successfully. You will not be charged for it. ` +
              `Is there anything else I can help with?`;
            resolution = "RESOLVED";
            summary =
              `Customer asked to cancel ${order.id}. The order was in Processing, ` +
              `so the cancellation policy allowed it and the order was cancelled.`;
            events.push(
              this.event("result_returned", "Cancellation completed", `${order.id} status set to Cancelled.`, "ok"),
            );
          } else {
            reply =
              `I was unable to complete the cancellation for ${order.id} just ` +
              `now. I will not claim it succeeded. Please try again or I can ` +
              `escalate this to the support team.`;
            resolution = "ESCALATION_REQUIRED";
            if (!next.unresolved.includes("Mock cancellation operation failed.")) {
              next.unresolved.push("Mock cancellation operation failed.");
            }
            events.push(
              this.event("result_returned", "Cancellation failed", "Mock operation did not succeed.", "error"),
            );
          }
        } else {
          reply = decision.detail;
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
          reply =
            "I can help with a return. Returns are accepted within seven days " +
            "of delivery, provided the product is unopened and in its original " +
            "packaging. Could you share the order id so I can check it?";
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
          reply =
            `${order.id} is within the seven-day return window, so I have ` +
            `logged a return request. Please keep the product unopened and in ` +
            `its original packaging. Is there anything else I can help with?`;
          resolution = "RESOLVED";
          summary = `Customer requested a return for ${order.id}. The order is within the seven-day window, so a return request was logged.`;
        } else {
          reply = decision.detail;
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
          askForOrderId(
            "I am sorry to hear about a damaged or defective product. Damage must be reported within 48 hours of delivery with photos.",
          );
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
        reply = decision.detail;
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
            reply = decision.detail;
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
        reply =
          "Cash on Delivery is available for orders up to ₹2,500, and you can " +
          "pay by cash or UPI at the doorstep. If you share an order id, I can " +
          "confirm whether it is available for that specific order.";
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
            events.push(this.event("policy_checked", "Shipping policy checked", quote.detail, quote.status === "boundary" ? "warn" : "ok"));
            reply = quote.detail;
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
        reply =
          "Orders above ₹499 qualify for free standard delivery, and orders " +
          "below ₹499 have a ₹50 shipping fee. Standard delivery takes three to " +
          "five business days. For an order of exactly ₹499, the supplied " +
          "policy does not specify the fee, so I would confirm that rather than " +
          "guess.";
        resolution = "RESOLVED";
        summary = "Customer asked about shipping charges. General shipping policy shared, including the unresolved exactly-₹499 boundary.";
        events.push(this.event("policy_checked", "Shipping policy explained", "Free above ₹499, ₹50 below ₹499, 3–5 business days; ₹499 boundary unresolved.", "ok"));
        break;
      }

      case "ORDER_TRACKING": {
        if (!orderId) {
          askForOrderId("I can track that for you.");
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
          `${order.id} for ${order.customerName} is currently "${order.status}".`,
        );
        if (order.courier && order.trackingRef) {
          parts.push(
            `It is with ${order.courier}, tracking reference ${order.trackingRef}.`,
          );
        } else {
          parts.push(
            "No courier or tracking reference has been supplied for this order yet.",
          );
          const note = "No courier or tracking data was supplied for this order.";
          if (!next.unresolved.includes(note)) next.unresolved.push(note);
        }
        parts.push(`Note: ${order.supplierNote}.`);
        parts.push("This is mock data, not live logistics.");
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
        reply =
          "That is a good question, but this demo does not include a product " +
          "catalogue, so I cannot confirm ingredient or usage details without " +
          "risk of giving you the wrong information. I can help with order " +
          "tracking, cancellations, returns, shipping, Cash on Delivery, and " +
          "damaged products. I can flag your product question for a specialist.";
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
        reply =
          "I am only able to help with Aura Skincare orders and support — " +
          "things like tracking, cancellations, returns, shipping, Cash on " +
          "Delivery, and damaged products. I am not able to help with that, " +
          "but I am happy to assist with anything Aura related.";
        resolution = "OUT_OF_SCOPE";
        summary = "Customer asked something outside Aura Skincare support; politely declined.";
        events.push(this.event("out_of_scope", "Request out of scope", "Politely declined a non-Aura request.", "warn"));
        break;
      }

      case "UNKNOWN":
      default: {
        const lc = text.toLowerCase().trim();
        const isGreeting = /^(hi|hello|hey|namaste|good (morning|afternoon|evening))\b/.test(lc);

        if (needsClarification === "order_action") {
          reply =
            "I can help with your order. Would you like to track it, cancel it, " +
            "or ask about returning it?";
          pending = "order_action";
          resolution = "UNRESOLVED";
          summary = "Customer referred to their order without a clear action; Aria asked whether they want to track, cancel or return.";
          events.push(this.event("clarification_requested", "Clarifying question", "Asked track / cancel / return.", "info"));
          break;
        }

        if (isGreeting) {
          reply =
            "Hello, and thank you for contacting Aura Skincare. I can help with " +
            "order tracking, cancellations, returns, shipping, Cash on Delivery, " +
            "or a damaged product. What would you like to do?";
          resolution = "UNRESOLVED";
          summary = "Customer greeted Aria; Aria offered the supported help topics.";
          break;
        }

        reply =
          "I am not sure I understood that. Could you rephrase it? I can help " +
          "with order tracking, cancellations, returns, shipping, Cash on " +
          "Delivery, and damaged products.";
        resolution = "UNRESOLVED";
        summary = "Aria could not confidently classify the request and asked the customer to rephrase.";
        events.push(this.event("clarification_requested", "Clarifying question", "Asked customer to rephrase.", "warn"));
        break;
      }
    }

    if (!summary) {
      summary = next.lastSummary ?? "No summary available.";
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
