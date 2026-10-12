import { describe, expect, it } from "vitest";
import {
  SAMPLE_ORDERS,
  canonicalOrderId,
  createInMemoryOrderRepository,
} from "../orders";

describe("order fixtures", () => {
  it("contains exactly the three assessment orders", () => {
    expect(SAMPLE_ORDERS.map((o) => o.id)).toEqual([
      "ORD-101",
      "ORD-102",
      "ORD-103",
    ]);
  });

  it("matches the supplied fixture values", () => {
    const [a, b, c] = SAMPLE_ORDERS;
    expect(a).toMatchObject({
      customerName: "Priya Sharma",
      productName: "Vitamin C Serum (30ml)",
      value: 699,
      status: "Out for Delivery",
      courier: "BlueDart",
      trackingRef: "BD-982103",
      supplierNote: "Expected by 6 PM today",
    });
    expect(b).toMatchObject({
      customerName: "Rahul Verma",
      productName: "Hydrating Sunscreen SPF 50",
      value: 499,
      status: "Delivered",
      courier: "Delhivery",
      trackingRef: "DL-441029",
      deliveredDaysAgo: 14,
    });
    expect(c).toMatchObject({
      customerName: "Ananya Patel",
      productName: "Green Tea Face Wash + Toner",
      value: 850,
      status: "Processing",
      courier: null,
      trackingRef: null,
      orderedHoursAgo: 3,
    });
  });

  it("does not invent courier data for ORD-103", () => {
    const ord103 = SAMPLE_ORDERS.find((o) => o.id === "ORD-103")!;
    expect(ord103.courier).toBeNull();
    expect(ord103.trackingRef).toBeNull();
  });
});

describe("canonicalOrderId", () => {
  it("normalises common formats", () => {
    expect(canonicalOrderId("ord-101")).toBe("ORD-101");
    expect(canonicalOrderId("ORD 101")).toBe("ORD-101");
    expect(canonicalOrderId("ord101")).toBe("ORD-101");
    expect(canonicalOrderId("101")).toBe("ORD-101");
    expect(canonicalOrderId("7")).toBe("ORD-007");
  });
  it("returns null for empty or nullish input", () => {
    expect(canonicalOrderId(null)).toBeNull();
    expect(canonicalOrderId("")).toBeNull();
    expect(canonicalOrderId("no digits here")).toBeNull();
  });
});

describe("in-memory repository", () => {
  it("lists and retrieves orders", () => {
    const repo = createInMemoryOrderRepository();
    expect(repo.list()).toHaveLength(3);
    expect(repo.getById("ORD-101")?.customerName).toBe("Priya Sharma");
  });

  it("accepts loose ids", () => {
    const repo = createInMemoryOrderRepository();
    expect(repo.getById("ord103")?.id).toBe("ORD-103");
  });

  it("returns null for unknown orders", () => {
    const repo = createInMemoryOrderRepository();
    expect(repo.getById("ORD-999")).toBeNull();
  });

  it("isolates state between instances and supports reset", () => {
    const repo = createInMemoryOrderRepository();
    repo.setStatus("ORD-103", "Cancelled");
    expect(repo.getById("ORD-103")?.status).toBe("Cancelled");
    repo.reset();
    expect(repo.getById("ORD-103")?.status).toBe("Processing");

    const fresh = createInMemoryOrderRepository();
    expect(fresh.getById("ORD-103")?.status).toBe("Processing");
  });

  it("returns clones so callers cannot mutate internal state", () => {
    const repo = createInMemoryOrderRepository();
    const order = repo.getById("ORD-101")!;
    order.status = "Cancelled";
    expect(repo.getById("ORD-101")?.status).toBe("Out for Delivery");
  });
});
