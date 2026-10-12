/**
 * Core domain types for Aura Voice CX.
 *
 * These types are intentionally framework-agnostic: the order repository,
 * policy engine, intent classifier and orchestrator can all be imported and
 * tested without a browser or Next.js runtime.
 */

export type OrderStatus =
  | "Processing"
  | "Shipped"
  | "Out for Delivery"
  | "Delivered"
  | "Cancelled";

/**
 * A mock customer order. This is a fixture, not live logistics data.
 *
 * `courier` and `trackingRef` are nullable on purpose: ORD-103 has no supplied
 * courier information and we must not invent it.
 */
export interface Order {
  id: string;
  customerName: string;
  productName: string;
  /** Order value in whole Indian Rupees. */
  value: number;
  status: OrderStatus;
  courier: string | null;
  trackingRef: string | null;
  /** The note exactly as supplied by the assessment brief. */
  supplierNote: string;
  /** Days since delivery, or null when the order has not been delivered. */
  deliveredDaysAgo: number | null;
  /** Hours since the order was placed, when supplied. */
  orderedHoursAgo: number | null;
}

export type Intent =
  | "ORDER_TRACKING"
  | "RETURN_REQUEST"
  | "CANCELLATION_REQUEST"
  | "SHIPPING_QUERY"
  | "COD_QUERY"
  | "DAMAGED_PRODUCT"
  | "GENERAL_PRODUCT_QUERY"
  | "OUT_OF_SCOPE"
  | "UNKNOWN";

export type ResolutionStatus =
  | "RESOLVED"
  | "UNRESOLVED"
  | "ESCALATION_REQUIRED"
  | "OUT_OF_SCOPE";

export type ClarificationKind =
  | "order_action"
  | "order_id"
  | "verify_order_id";

export type PolicyDecisionStatus =
  | "allowed"
  | "denied"
  | "boundary"
  | "unknown";

/** A structured, explainable outcome from a policy evaluation. */
export interface PolicyDecision {
  status: PolicyDecisionStatus;
  /** Stable policy reference, e.g. "cancellation.processing_only". */
  rule: string;
  /** Short human title, e.g. "Cancellation window". */
  title: string;
  /** Plain-language explanation suitable for speaking aloud. */
  detail: string;
  /** The agent may only promise the customer an action when this is true. */
  canPromise: boolean;
}

export interface ShippingQuote {
  status: PolicyDecisionStatus;
  rule: string;
  title: string;
  detail: string;
  /** Shipping fee in rupees, or null when it cannot be determined. */
  fee: number | null;
  freeDelivery: boolean | null;
  /** Standard delivery estimate in business days [min, max]. */
  etaBusinessDays: [number, number];
}

export interface ReturnEligibility {
  status: PolicyDecisionStatus;
  rule: string;
  title: string;
  detail: string;
  canPromise: boolean;
  withinWindow: boolean | null;
}

export interface CancellationEligibility {
  status: PolicyDecisionStatus;
  rule: string;
  title: string;
  detail: string;
  canPromise: boolean;
}

export interface CodEligibility {
  status: PolicyDecisionStatus;
  rule: string;
  title: string;
  detail: string;
  canPromise: boolean;
}

export interface DamagedProductPolicy {
  status: PolicyDecisionStatus;
  rule: string;
  title: string;
  detail: string;
  canPromise: boolean;
  requiresPhotos: boolean;
  /** Reporting window in hours from delivery. */
  windowHours: number;
}
