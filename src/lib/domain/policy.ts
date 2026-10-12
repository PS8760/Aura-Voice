import type {
  CancellationEligibility,
  CodEligibility,
  DamagedProductPolicy,
  Order,
  PolicyDecision,
  ReturnEligibility,
  ShippingQuote,
} from "./types";

/**
 * Centralised, typed Aura Skincare policy engine.
 *
 * Every function is pure and independently testable. Application code — never
 * an LLM — decides whether an action is permitted. A local model may request
 * an action, but it must be routed through these functions.
 *
 * Policy references (the `rule` field) are stable identifiers used by the UI
 * and tests to prove the rule was actually checked.
 */

export const POLICY_FREE_SHIPPING_THRESHOLD = 499;
export const POLICY_BELOW_THRESHOLD_FEE = 50;
export const POLICY_STANDARD_ETA_DAYS: [number, number] = [3, 5];
export const POLICY_RETURN_WINDOW_DAYS = 7;
export const POLICY_DAMAGE_REPORT_WINDOW_HOURS = 48;
export const POLICY_COD_LIMIT = 2500;

/**
 * Shipping policy.
 *
 * The supplied brief defines behaviour above and below ₹499 but explicitly
 * leaves the exactly-₹499 case unspecified. We represent that as an
 * unresolved policy boundary rather than inventing a rule.
 */
export function evaluateShipping(orderValue: number): ShippingQuote {
  const base = {
    rule: "shipping.free_above_threshold",
    title: "Shipping charges",
    etaBusinessDays: POLICY_STANDARD_ETA_DAYS,
  } as const;

  if (orderValue < 0 || !Number.isFinite(orderValue)) {
    return {
      ...base,
      status: "unknown",
      fee: null,
      freeDelivery: null,
      detail:
        "I do not have a valid order value to apply the shipping rule to.",
    };
  }

  if (orderValue > POLICY_FREE_SHIPPING_THRESHOLD) {
    return {
      ...base,
      status: "allowed",
      fee: 0,
      freeDelivery: true,
      detail:
        "Orders above ₹499 qualify for free standard delivery, which takes " +
        "3 to 5 business days.",
    };
  }

  if (orderValue < POLICY_FREE_SHIPPING_THRESHOLD) {
    return {
      ...base,
      status: "allowed",
      fee: POLICY_BELOW_THRESHOLD_FEE,
      freeDelivery: false,
      detail:
        "Orders below ₹499 incur a ₹50 shipping fee. Standard delivery takes " +
        "3 to 5 business days.",
    };
  }

  return {
    status: "boundary",
    rule: "shipping.threshold_boundary",
    title: "Shipping charges (policy boundary)",
    fee: null,
    freeDelivery: null,
    etaBusinessDays: POLICY_STANDARD_ETA_DAYS,
    detail:
      "This order is exactly ₹499. The supplied policy does not specify the " +
      "shipping rule for exactly ₹499, so I cannot confirm the fee and will " +
      "not guess. I can flag this for the support team if you would like.",
  };
}

/**
 * Return eligibility. Returns are accepted within seven days of delivery and
 * only for unopened, unused products in original packaging.
 */
export function evaluateReturn(input: {
  deliveredDaysAgo: number | null;
  intactPackaging?: boolean;
}): ReturnEligibility {
  const { deliveredDaysAgo, intactPackaging = true } = input;
  const rule = "returns.within_seven_days";
  const title = "Return eligibility";

  if (deliveredDaysAgo === null) {
    return {
      status: "unknown",
      rule: "returns.after_delivery",
      title,
      canPromise: false,
      withinWindow: null,
      detail:
        "I can only assess a return once the order has been delivered, and I " +
        "do not have a delivery confirmation for this order.",
    };
  }

  if (deliveredDaysAgo > POLICY_RETURN_WINDOW_DAYS) {
    return {
      status: "denied",
      rule,
      title,
      canPromise: false,
      withinWindow: false,
      detail:
        `Returns are accepted within ${POLICY_RETURN_WINDOW_DAYS} days of ` +
        `delivery. This order was delivered ${deliveredDaysAgo} days ago, so ` +
        "it falls outside the return window. I cannot offer a refund or " +
        "replacement for it.",
    };
  }

  if (!intactPackaging) {
    return {
      status: "denied",
      rule: "returns.unopened_original_packaging",
      title,
      canPromise: false,
      withinWindow: true,
      detail:
        "Returns require the product to be unopened, unused and in its " +
        "original packaging, so this item is not eligible as described.",
    };
  }

  return {
    status: "allowed",
    rule,
    title,
    canPromise: true,
    withinWindow: true,
    detail:
      `Within the ${POLICY_RETURN_WINDOW_DAYS}-day window and, assuming the ` +
      "product is unopened and in original packaging, this return can be " +
      "accepted.",
  };
}

/**
 * Cancellation eligibility. Permitted only while an order is Processing.
 * Shipped and Out for Delivery orders cannot be cancelled; the customer may
 * refuse delivery at the doorstep instead.
 */
export function evaluateCancellation(
  order: Pick<Order, "status"> | null,
): CancellationEligibility {
  const title = "Cancellation eligibility";

  if (!order) {
    return {
      status: "unknown",
      rule: "cancellation.processing_only",
      title,
      canPromise: false,
      detail:
        "I need a valid order to check cancellation eligibility. Please " +
        "share the order id.",
    };
  }

  if (order.status === "Processing") {
    return {
      status: "allowed",
      rule: "cancellation.processing_only",
      title,
      canPromise: true,
      detail:
        "This order is still Processing, so it is eligible for cancellation.",
    };
  }

  if (order.status === "Cancelled") {
    return {
      status: "denied",
      rule: "cancellation.already_cancelled",
      title,
      canPromise: false,
      detail: "This order has already been cancelled, so no further action is needed.",
    };
  }

  const doorstep =
    order.status === "Shipped" || order.status === "Out for Delivery"
      ? " You can refuse the delivery at your doorstep instead."
      : "";

  return {
    status: "denied",
    rule: "cancellation.processing_only",
    title,
    canPromise: false,
    detail:
      `Cancellation is only permitted while an order is Processing. This ` +
      `order is currently "${order.status}", so it cannot be cancelled.` +
      doorstep,
  };
}

/**
 * Cash on Delivery policy. COD is available for orders up to ₹2,500, payable
 * by cash or UPI at the doorstep.
 */
export function evaluateCod(orderValue: number): CodEligibility {
  const title = "Cash on Delivery";
  const rule = "cod.up_to_2500";

  if (!Number.isFinite(orderValue) || orderValue < 0) {
    return {
      status: "unknown",
      rule,
      title,
      canPromise: false,
      detail: "I need a valid order value to check Cash on Delivery eligibility.",
    };
  }

  if (orderValue <= POLICY_COD_LIMIT) {
    return {
      status: "allowed",
      rule,
      title,
      canPromise: true,
      detail:
        `Cash on Delivery is available for this order. You may pay by cash ` +
        `or UPI at the doorstep. COD is offered on orders up to ₹${POLICY_COD_LIMIT}.`,
    };
  }

  return {
    status: "denied",
    rule,
    title,
    canPromise: false,
    detail:
      `Cash on Delivery is only available for orders up to ₹${POLICY_COD_LIMIT}. ` +
      `This order is ₹${orderValue}, so COD is not available for it.`,
  };
}

/**
 * Damaged or defective product policy. Must be reported within 48 hours of
 * delivery with photos for replacement.
 */
export function evaluateDamagedProduct(input: {
  deliveredDaysAgo: number | null;
  hasPhotos?: boolean;
}): DamagedProductPolicy {
  const { deliveredDaysAgo, hasPhotos = false } = input;
  const rule = "damaged.report_within_48_hours";
  const title = "Damaged or defective product";

  if (deliveredDaysAgo === null) {
    return {
      status: "unknown",
      rule: "damaged.after_delivery",
      title,
      canPromise: false,
      requiresPhotos: true,
      windowHours: POLICY_DAMAGE_REPORT_WINDOW_HOURS,
      detail:
        "Damaged or defective items can be reported within 48 hours of " +
        "delivery. I do not have a delivery confirmation for this order, so " +
        "please share the order id and delivery details.",
    };
  }

  const hoursSinceDelivery = deliveredDaysAgo * 24;

  if (hoursSinceDelivery > POLICY_DAMAGE_REPORT_WINDOW_HOURS) {
    return {
      status: "denied",
      rule,
      title,
      canPromise: false,
      requiresPhotos: true,
      windowHours: POLICY_DAMAGE_REPORT_WINDOW_HOURS,
      detail:
        `Damaged or defective products must be reported within ` +
        `${POLICY_DAMAGE_REPORT_WINDOW_HOURS} hours of delivery. This order ` +
        `was delivered about ${hoursSinceDelivery} hours ago, so it is past ` +
        "the reporting window and I cannot offer a replacement.",
    };
  }

  if (!hasPhotos) {
    return {
      status: "boundary",
      rule: "damaged.requires_photos",
      title,
      canPromise: false,
      requiresPhotos: true,
      windowHours: POLICY_DAMAGE_REPORT_WINDOW_HOURS,
      detail:
        "This is within the 48-hour reporting window, but a replacement " +
        "requires photos of the damaged or defective product. Please share " +
        "photos and I can raise the replacement request.",
    };
  }

  return {
    status: "allowed",
    rule,
    title,
    canPromise: true,
    requiresPhotos: true,
    windowHours: POLICY_DAMAGE_REPORT_WINDOW_HOURS,
    detail:
      "This is within the 48-hour reporting window and photos were provided, " +
      "so a replacement request can be raised.",
  };
}

/** Convenience: a single, generic summariser for policy explanations. */
export function explainDecision(decision: PolicyDecision): string {
  return `${decision.title}: ${decision.detail}`;
}
