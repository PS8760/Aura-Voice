import { describe, expect, it } from "vitest";
import {
  evaluateCancellation,
  evaluateCod,
  evaluateDamagedProduct,
  evaluateReturn,
  evaluateShipping,
} from "../policy";
import type { OrderStatus } from "../types";

describe("shipping policy", () => {
  it("grants free delivery above ₹499", () => {
    const quote = evaluateShipping(699);
    expect(quote.status).toBe("allowed");
    expect(quote.freeDelivery).toBe(true);
    expect(quote.fee).toBe(0);
  });

  it("charges ₹50 below ₹499", () => {
    const quote = evaluateShipping(498);
    expect(quote.status).toBe("allowed");
    expect(quote.freeDelivery).toBe(false);
    expect(quote.fee).toBe(50);
  });

  it("treats exactly ₹499 as an unresolved boundary rather than guessing", () => {
    const quote = evaluateShipping(499);
    expect(quote.status).toBe("boundary");
    expect(quote.fee).toBeNull();
    expect(quote.freeDelivery).toBeNull();
    expect(quote.detail.toLowerCase()).toContain("does not specify");
  });

  it("always reports the 3–5 business day estimate", () => {
    expect(evaluateShipping(1000).etaBusinessDays).toEqual([3, 5]);
    expect(evaluateShipping(499).etaBusinessDays).toEqual([3, 5]);
  });

  it("returns unknown for an invalid value", () => {
    expect(evaluateShipping(Number.NaN).status).toBe("unknown");
    expect(evaluateShipping(-10).status).toBe("unknown");
  });
});

describe("return policy", () => {
  it("allows a return inside the seven-day window", () => {
    const result = evaluateReturn({ deliveredDaysAgo: 3 });
    expect(result.status).toBe("allowed");
    expect(result.canPromise).toBe(true);
    expect(result.withinWindow).toBe(true);
  });

  it("denies a return outside the seven-day window (ORD-102 case)", () => {
    const result = evaluateReturn({ deliveredDaysAgo: 14 });
    expect(result.status).toBe("denied");
    expect(result.canPromise).toBe(false);
    expect(result.withinWindow).toBe(false);
  });

  it("denies when packaging is not intact", () => {
    const result = evaluateReturn({ deliveredDaysAgo: 2, intactPackaging: false });
    expect(result.status).toBe("denied");
  });

  it("returns unknown when the order is not delivered", () => {
    expect(evaluateReturn({ deliveredDaysAgo: null }).status).toBe("unknown");
  });
});

describe("cancellation policy", () => {
  const statuses: Array<[OrderStatus, string]> = [
    ["Processing", "allowed"],
    ["Shipped", "denied"],
    ["Out for Delivery", "denied"],
    ["Delivered", "denied"],
    ["Cancelled", "denied"],
  ];

  it.each(statuses)("handles %s orders", (status, expected) => {
    expect(evaluateCancellation({ status }).status).toBe(expected);
  });

  it("mentions doorstep refusal for out-for-delivery orders", () => {
    const result = evaluateCancellation({ status: "Out for Delivery" });
    expect(result.detail.toLowerCase()).toContain("refuse");
  });

  it("returns unknown when there is no order", () => {
    expect(evaluateCancellation(null).status).toBe("unknown");
  });
});

describe("cash on delivery policy", () => {
  it("allows COD at exactly the ₹2,500 limit", () => {
    expect(evaluateCod(2500).status).toBe("allowed");
  });
  it("denies COD above ₹2,500", () => {
    expect(evaluateCod(2501).status).toBe("denied");
  });
  it("allows COD for a typical order", () => {
    expect(evaluateCod(850).status).toBe("allowed");
  });
  it("returns unknown for an invalid value", () => {
    expect(evaluateCod(Number.NaN).status).toBe("unknown");
  });
});

describe("damaged product policy", () => {
  it("requires photos inside the window", () => {
    const result = evaluateDamagedProduct({ deliveredDaysAgo: 0, hasPhotos: false });
    expect(result.status).toBe("boundary");
    expect(result.requiresPhotos).toBe(true);
  });
  it("allows a replacement inside the window with photos", () => {
    expect(
      evaluateDamagedProduct({ deliveredDaysAgo: 1, hasPhotos: true }).status,
    ).toBe("allowed");
  });
  it("denies a report after 48 hours", () => {
    expect(
      evaluateDamagedProduct({ deliveredDaysAgo: 14, hasPhotos: true }).status,
    ).toBe("denied");
  });
  it("returns unknown without delivery confirmation", () => {
    expect(
      evaluateDamagedProduct({ deliveredDaysAgo: null, hasPhotos: true }).status,
    ).toBe("unknown");
  });
});
