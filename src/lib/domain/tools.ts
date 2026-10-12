import { z } from "zod";
import type { OrderRepository } from "./orders";
import {
  evaluateCancellation,
  evaluateCod,
  evaluateDamagedProduct,
  evaluateReturn,
  evaluateShipping,
} from "./policy";
import type { Order } from "./types";

export type ToolName =
  | "lookup_order"
  | "check_shipping"
  | "check_cancellation_eligibility"
  | "check_return_eligibility"
  | "check_damaged_product"
  | "check_cod_eligibility";

export type ToolErrorCode =
  | "INVALID_INPUT"
  | "ORDER_NOT_FOUND"
  | "ORDER_ID_REQUIRED"
  | "REPOSITORY_ERROR";

export interface ToolError {
  code: ToolErrorCode;
  message: string;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ToolError;
}

export interface ToolCallRecord {
  id: string;
  name: ToolName;
  input: Record<string, unknown>;
  ok: boolean;
  error?: ToolError;
  /** Short human label for the live activity timeline. */
  summary: string;
  at: string;
}

const orderIdSchema = z.string().min(1, "order id is required");
const orderValueSchema = z.number().finite();

let toolCallCounter = 0;
function nextToolCallId(): string {
  toolCallCounter += 1;
  return `tool_${toolCallCounter.toString(36)}_${Date.now().toString(36)}`;
}

/**
 * Typed tool executor. Every tool validates its input at runtime and returns a
 * discriminated result instead of throwing, so the orchestrator can always
 * produce an honest spoken response.
 */
export class ToolExecutor {
  constructor(
    private readonly repo: OrderRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private record(
    name: ToolName,
    input: Record<string, unknown>,
    result: ToolResult,
    summary: string,
  ): ToolCallRecord {
    return {
      id: nextToolCallId(),
      name,
      input,
      ok: result.ok,
      error: result.error,
      summary,
      at: this.now().toISOString(),
    };
  }

  lookupOrder(rawId: unknown): { result: ToolResult<Order>; call: ToolCallRecord } {
    const parsed = orderIdSchema.safeParse(rawId);
    if (!parsed.success) {
      const error: ToolError = {
        code: "ORDER_ID_REQUIRED",
        message: "No order id was supplied for the lookup.",
      };
      const result: ToolResult<Order> = { ok: false, error };
      return {
        result,
        call: this.record("lookup_order", { order_id: rawId ?? null }, result, "Order lookup skipped: missing order id"),
      };
    }

    let order: Order | null = null;
    try {
      order = this.repo.getById(parsed.data);
    } catch {
      const error: ToolError = {
        code: "REPOSITORY_ERROR",
        message: "The order service is currently unavailable.",
      };
      const result: ToolResult<Order> = { ok: false, error };
      return {
        result,
        call: this.record("lookup_order", { order_id: parsed.data }, result, "Order lookup failed"),
      };
    }

    if (!order) {
      const error: ToolError = {
        code: "ORDER_NOT_FOUND",
        message: `No order found for "${parsed.data}".`,
      };
      const result: ToolResult<Order> = { ok: false, error };
      return {
        result,
        call: this.record(
          "lookup_order",
          { order_id: parsed.data },
          result,
          `Order lookup: ${parsed.data} not found`,
        ),
      };
    }

    const result: ToolResult<Order> = { ok: true, data: order };
    return {
      result,
      call: this.record(
        "lookup_order",
        { order_id: parsed.data },
        result,
        `Order lookup: ${order.id} found (${order.status})`,
      ),
    };
  }

  checkShipping(rawValue: unknown): { result: ToolResult<ReturnType<typeof evaluateShipping>>; call: ToolCallRecord } {
    const parsed = orderValueSchema.safeParse(rawValue);
    if (!parsed.success) {
      const error: ToolError = {
        code: "INVALID_INPUT",
        message: "A numeric order value is required to check shipping.",
      };
      const result: ToolResult<ReturnType<typeof evaluateShipping>> = { ok: false, error };
      return {
        result,
        call: this.record("check_shipping", { order_value: rawValue ?? null }, result, "Shipping check skipped: invalid value"),
      };
    }
    const quote = evaluateShipping(parsed.data);
    const result = { ok: true, data: quote };
    return {
      result,
      call: this.record(
        "check_shipping",
        { order_value: parsed.data },
        result,
        `Shipping rule checked for ₹${parsed.data}`,
      ),
    };
  }

  checkCancellation(rawId: unknown): { result: ToolResult<ReturnType<typeof evaluateCancellation>>; call: ToolCallRecord } {
    const lookup = this.lookupOrder(rawId);
    if (!lookup.result.ok || !lookup.result.data) {
      return {
        result: { ok: false, error: lookup.result.error },
        call: this.record(
          "check_cancellation_eligibility",
          { order_id: rawId ?? null },
          { ok: false, error: lookup.result.error },
          "Cancellation check blocked: order not available",
        ),
      };
    }
    const decision = evaluateCancellation(lookup.result.data);
    const result = { ok: true, data: decision };
    return {
      result,
      call: this.record(
        "check_cancellation_eligibility",
        { order_id: lookup.result.data.id },
        result,
        `Cancellation policy checked (${decision.status})`,
      ),
    };
  }

  checkReturn(rawId: unknown): { result: ToolResult<ReturnType<typeof evaluateReturn>>; call: ToolCallRecord } {
    const lookup = this.lookupOrder(rawId);
    if (!lookup.result.ok || !lookup.result.data) {
      return {
        result: { ok: false, error: lookup.result.error },
        call: this.record(
          "check_return_eligibility",
          { order_id: rawId ?? null },
          { ok: false, error: lookup.result.error },
          "Return check blocked: order not available",
        ),
      };
    }
    const order = lookup.result.data;
    const decision = evaluateReturn({ deliveredDaysAgo: order.deliveredDaysAgo });
    const result = { ok: true, data: decision };
    return {
      result,
      call: this.record(
        "check_return_eligibility",
        { order_id: order.id },
        result,
        `Return policy checked (${decision.status})`,
      ),
    };
  }

  checkDamaged(rawId: unknown, hasPhotos: unknown): { result: ToolResult<ReturnType<typeof evaluateDamagedProduct>>; call: ToolCallRecord } {
    const lookup = this.lookupOrder(rawId);
    if (!lookup.result.ok || !lookup.result.data) {
      return {
        result: { ok: false, error: lookup.result.error },
        call: this.record(
          "check_damaged_product",
          { order_id: rawId ?? null, has_photos: Boolean(hasPhotos) },
          { ok: false, error: lookup.result.error },
          "Damaged-product check blocked: order not available",
        ),
      };
    }
    const order = lookup.result.data;
    const decision = evaluateDamagedProduct({
      deliveredDaysAgo: order.deliveredDaysAgo,
      hasPhotos: Boolean(hasPhotos),
    });
    const result = { ok: true, data: decision };
    return {
      result,
      call: this.record(
        "check_damaged_product",
        { order_id: order.id, has_photos: Boolean(hasPhotos) },
        result,
        `Damaged-product policy checked (${decision.status})`,
      ),
    };
  }

  checkCod(rawId: unknown): { result: ToolResult<ReturnType<typeof evaluateCod>>; call: ToolCallRecord } {
    const lookup = this.lookupOrder(rawId);
    if (!lookup.result.ok || !lookup.result.data) {
      return {
        result: { ok: false, error: lookup.result.error },
        call: this.record(
          "check_cod_eligibility",
          { order_id: rawId ?? null },
          { ok: false, error: lookup.result.error },
          "COD check blocked: order not available",
        ),
      };
    }
    const order = lookup.result.data;
    const decision = evaluateCod(order.value);
    const result = { ok: true, data: decision };
    return {
      result,
      call: this.record(
        "check_cod_eligibility",
        { order_id: order.id },
        result,
        `COD policy checked (${decision.status})`,
      ),
    };
  }
}
