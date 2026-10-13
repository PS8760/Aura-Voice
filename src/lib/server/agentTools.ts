import {
  evaluateCancellation,
  evaluateCod,
  evaluateDamagedProduct,
  evaluateReturn,
  evaluateShipping,
} from "@/lib/domain/policy";
import { canonicalOrderId, type OrderRepository } from "@/lib/domain/orders";
import { INTENTS } from "@/lib/domain/outcome";
import type { ClarificationKind, Intent, Order } from "@/lib/domain/types";

/**
 * Tools exposed to the optional local model.
 *
 * The model may *request* these, but every evaluation is performed by the
 * deterministic policy functions below. The model never mutates an order and
 * never decides eligibility — it only gathers verified facts and proposes a
 * structured understanding for the code layer to act on.
 */
export const AGENT_TOOL_NAMES = [
  "lookup_order",
  "check_cancellation",
  "check_return",
  "check_shipping",
  "check_cod",
  "check_damaged_product",
  "escalate_to_human",
  "submit_understanding",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export interface AgentToolContext {
  repo: OrderRepository;
  now: () => Date;
}

export interface AgentToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface AgentOrderFacts {
  id: string;
  customer_name: string;
  product_name: string;
  value: number;
  status: string;
  courier: string | null;
  tracking_ref: string | null;
  supplier_note: string;
  delivered_days_ago: number | null;
  ordered_hours_ago: number | null;
}

export function orderFacts(order: Order): AgentOrderFacts {
  return {
    id: order.id,
    customer_name: order.customerName,
    product_name: order.productName,
    value: order.value,
    status: order.status,
    courier: order.courier,
    tracking_ref: order.trackingRef,
    supplier_note: order.supplierNote,
    delivered_days_ago: order.deliveredDaysAgo,
    ordered_hours_ago: order.orderedHoursAgo,
  };
}

export interface AgentUnderstanding {
  intent: Intent;
  orderId: string | null;
  confidence: number;
  sentiment: "neutral" | "frustrated" | "happy" | "confused";
  needsClarification: ClarificationKind | null;
  needsEscalation: boolean;
  reason: string;
  draftReply: string | null;
}

const SENTIMENTS = ["neutral", "frustrated", "happy", "confused"] as const;
const CLARIFICATIONS = ["order_action", "order_id", "verify_order_id"] as const;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Parse and clamp the model's structured understanding. Anything invalid is
 * coerced to a safe value (UNKNOWN intent, no order id) rather than trusted.
 */
export function parseUnderstanding(args: unknown): AgentUnderstanding {
  const record = asRecord(args);
  const rawIntent = asString(record.intent).toUpperCase();
  const intent = (INTENTS as readonly string[]).includes(rawIntent)
    ? (rawIntent as Intent)
    : "UNKNOWN";

  const rawSentiment = asString(record.sentiment).toLowerCase();
  const sentiment = (SENTIMENTS as readonly string[]).includes(rawSentiment)
    ? (rawSentiment as AgentUnderstanding["sentiment"])
    : "neutral";

  const rawClarification = asString(record.needs_clarification).toLowerCase();
  const needsClarification = (CLARIFICATIONS as readonly string[]).includes(
    rawClarification,
  )
    ? (rawClarification as ClarificationKind)
    : null;

  const rawConfidence =
    typeof record.confidence === "number" ? record.confidence : Number(record.confidence);

  const draft = asString(record.draft_reply);

  return {
    intent,
    orderId: canonicalOrderId(asString(record.order_id)) ?? null,
    confidence: Number.isFinite(rawConfidence)
      ? Math.min(1, Math.max(0, rawConfidence))
      : 0,
    sentiment,
    needsClarification,
    needsEscalation: record.needs_escalation === true,
    reason: asString(record.reason),
    draftReply: draft || null,
  };
}

function lookup(
  ctx: AgentToolContext,
  rawId: unknown,
): { ok: true; order: Order } | { ok: false; result: AgentToolResult } {
  const id = canonicalOrderId(asString(rawId));
  if (!id) {
    return { ok: false, result: { ok: false, error: "ORDER_ID_REQUIRED" } };
  }
  const order = ctx.repo.getById(id);
  if (!order) {
    return { ok: false, result: { ok: false, error: `ORDER_NOT_FOUND: ${id}` } };
  }
  return { ok: true, order };
}

/**
 * Execute a single tool call. Read-only by design: no order status is ever
 * changed here. Action execution happens later, in code, inside the
 * orchestrator once the whole understanding has been assembled.
 */
export function executeAgentTool(
  name: AgentToolName,
  args: unknown,
  ctx: AgentToolContext,
): AgentToolResult {
  const record = asRecord(args);

  switch (name) {
    case "lookup_order": {
      const found = lookup(ctx, record.order_id);
      if (!found.ok) return found.result;
      return { ok: true, data: { order: orderFacts(found.order) } };
    }

    case "check_cancellation": {
      const found = lookup(ctx, record.order_id);
      if (!found.ok) return found.result;
      const decision = evaluateCancellation(found.order);
      return {
        ok: true,
        data: {
          order_id: found.order.id,
          status: decision.status,
          can_promise: decision.canPromise,
          rule: decision.rule,
          detail: decision.detail,
        },
      };
    }

    case "check_return": {
      const found = lookup(ctx, record.order_id);
      if (!found.ok) return found.result;
      const decision = evaluateReturn({ deliveredDaysAgo: found.order.deliveredDaysAgo });
      return {
        ok: true,
        data: {
          order_id: found.order.id,
          status: decision.status,
          can_promise: decision.canPromise,
          rule: decision.rule,
          detail: decision.detail,
        },
      };
    }

    case "check_shipping": {
      const found = lookup(ctx, record.order_id);
      if (!found.ok) return found.result;
      const quote = evaluateShipping(found.order.value);
      return {
        ok: true,
        data: {
          order_id: found.order.id,
          status: quote.status,
          rule: quote.rule,
          fee: quote.fee,
          free_delivery: quote.freeDelivery,
          detail: quote.detail,
        },
      };
    }

    case "check_cod": {
      const found = lookup(ctx, record.order_id);
      if (!found.ok) return found.result;
      const decision = evaluateCod(found.order.value);
      return {
        ok: true,
        data: {
          order_id: found.order.id,
          status: decision.status,
          can_promise: decision.canPromise,
          rule: decision.rule,
          detail: decision.detail,
        },
      };
    }

    case "check_damaged_product": {
      const found = lookup(ctx, record.order_id);
      if (!found.ok) return found.result;
      const decision = evaluateDamagedProduct({
        deliveredDaysAgo: found.order.deliveredDaysAgo,
        hasPhotos: record.has_photos === true,
      });
      return {
        ok: true,
        data: {
          order_id: found.order.id,
          status: decision.status,
          can_promise: decision.canPromise,
          rule: decision.rule,
          detail: decision.detail,
        },
      };
    }

    case "escalate_to_human": {
      return {
        ok: true,
        data: { acknowledged: true, reason: asString(record.reason) || "customer request" },
      };
    }

    case "submit_understanding": {
      return { ok: true, data: { submitted: true } };
    }

    default:
      return { ok: false, error: `UNKNOWN_TOOL: ${String(name)}` };
  }
}

const orderIdParam = {
  type: "object",
  properties: {
    order_id: {
      type: "string",
      description: "The customer order id, e.g. ORD-101.",
    },
  },
  required: ["order_id"],
} as const;

/** OpenAI/Ollama function-tool descriptions. */
export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "lookup_order",
      description:
        "Return verified facts for one order (status, customer, value, courier, tracking reference, delivery timing). Use before answering anything about a specific order.",
      parameters: orderIdParam,
    },
  },
  {
    type: "function",
    function: {
      name: "check_cancellation",
      description:
        "Check whether an order can be cancelled. Returns the policy decision. Never decide this yourself.",
      parameters: orderIdParam,
    },
  },
  {
    type: "function",
    function: {
      name: "check_return",
      description:
        "Check whether an order is within the return window. Returns the policy decision.",
      parameters: orderIdParam,
    },
  },
  {
    type: "function",
    function: {
      name: "check_shipping",
      description:
        "Check the shipping charge rule for an order based on its value.",
      parameters: orderIdParam,
    },
  },
  {
    type: "function",
    function: {
      name: "check_cod",
      description: "Check whether Cash on Delivery is available for an order.",
      parameters: orderIdParam,
    },
  },
  {
    type: "function",
    function: {
      name: "check_damaged_product",
      description:
        "Check the damaged-product replacement policy for an order within the reporting window.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string" },
          has_photos: {
            type: "boolean",
            description: "Whether the customer has already provided photos.",
          },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human",
      description:
        "Record that a human specialist is needed (e.g. catalogue/ingredient questions or an unresolved complaint).",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why escalation is needed." },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_understanding",
      description:
        "REQUIRED final step. Submit your structured understanding of the customer's message after you have gathered any needed facts with the other tools.",
      parameters: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            enum: [...INTENTS],
            description: "The customer's primary intent.",
          },
          order_id: {
            type: "string",
            description: "The relevant order id, or empty if none.",
          },
          confidence: {
            type: "number",
            description: "Your confidence from 0 to 1.",
          },
          sentiment: {
            type: "string",
            enum: [...SENTIMENTS],
          },
          needs_clarification: {
            type: "string",
            enum: [...CLARIFICATIONS],
            description: "Set only when you must ask the customer to clarify.",
          },
          needs_escalation: { type: "boolean" },
          reason: { type: "string", description: "Brief reasoning." },
          draft_reply: {
            type: "string",
            description:
              "Optional: a 2-4 sentence customer-facing reply that ONLY restates the verified tool results. Never invent order data, couriers, tracking numbers or policy values.",
          },
        },
        required: ["intent", "order_id", "confidence", "sentiment", "reason"],
      },
    },
  },
] as const;
