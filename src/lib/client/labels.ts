import type { Intent, ResolutionStatus } from "@/lib/domain/types";

/** Human-facing labels for the documented intent taxonomy. */
export const INTENT_LABELS: Record<Intent, string> = {
  ORDER_TRACKING: "Order tracking",
  RETURN_REQUEST: "Return request",
  CANCELLATION_REQUEST: "Cancellation request",
  SHIPPING_QUERY: "Shipping query",
  COD_QUERY: "Cash on Delivery query",
  DAMAGED_PRODUCT: "Damaged product",
  GENERAL_PRODUCT_QUERY: "Product question",
  OUT_OF_SCOPE: "Out of scope",
  UNKNOWN: "Unclear / unknown",
};

export const RESOLUTION_LABELS: Record<ResolutionStatus, string> = {
  RESOLVED: "Resolved",
  UNRESOLVED: "Unresolved",
  ESCALATION_REQUIRED: "Escalation required",
  OUT_OF_SCOPE: "Out of scope",
};

export function intentLabel(intent: Intent | null | undefined): string {
  if (!intent) return "Not yet determined";
  return INTENT_LABELS[intent] ?? intent;
}

export function resolutionLabel(
  status: ResolutionStatus | null | undefined,
): string {
  if (!status) return "Not yet determined";
  return RESOLUTION_LABELS[status] ?? status;
}
