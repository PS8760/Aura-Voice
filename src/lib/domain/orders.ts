import type { Order, OrderStatus } from "./types";

/**
 * Fixture version is surfaced in the UI/health endpoint so the evaluator can
 * confirm exactly which dataset the demo is running against.
 */
export const FIXTURE_VERSION = "assessment-orders-v1";

/**
 * The single source of truth for the three assessment orders.
 *
 * These are mock fixtures. ORD-103 deliberately has no courier/tracking data
 * because none was supplied; the application must not invent it.
 */
export const SAMPLE_ORDERS: readonly Order[] = Object.freeze([
  {
    id: "ORD-101",
    customerName: "Priya Sharma",
    productName: "Vitamin C Serum (30ml)",
    value: 699,
    status: "Out for Delivery",
    courier: "BlueDart",
    trackingRef: "BD-982103",
    supplierNote: "Expected by 6 PM today",
    deliveredDaysAgo: null,
    orderedHoursAgo: null,
  },
  {
    id: "ORD-102",
    customerName: "Rahul Verma",
    productName: "Hydrating Sunscreen SPF 50",
    value: 499,
    status: "Delivered",
    courier: "Delhivery",
    trackingRef: "DL-441029",
    supplierNote: "Delivered 14 days ago",
    deliveredDaysAgo: 14,
    orderedHoursAgo: null,
  },
  {
    id: "ORD-103",
    customerName: "Ananya Patel",
    productName: "Green Tea Face Wash + Toner",
    value: 850,
    status: "Processing",
    courier: null,
    trackingRef: null,
    supplierNote: "Ordered 3 hours ago; eligible for cancellation.",
    deliveredDaysAgo: null,
    orderedHoursAgo: 3,
  },
]);

function cloneOrder(order: Order): Order {
  return { ...order };
}

export interface OrderRepository {
  list(): Order[];
  getById(id: string): Order | null;
  /** Applies a status change. Returns the updated order, or null if absent. */
  setStatus(id: string, status: OrderStatus): Order | null;
  /** Restores the repository to the pristine fixture state. */
  reset(): void;
}

/**
 * Normalises loose user input into a canonical order id, or null.
 * Accepts "ord-101", "ORD 101", "ord101", "101" and similar.
 */
export function canonicalOrderId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = /(\d{1,4})/.exec(raw);
  if (!match) return null;
  const digits = match[1].padStart(3, "0");
  return `ORD-${digits}`;
}

/**
 * Create an in-memory repository. Each call gets an isolated copy of the
 * fixtures so mutations (mock cancellation) never leak between tests.
 *
 * The signature mirrors a database-backed implementation so the UI and
 * services never depend on the storage strategy.
 */
export function createInMemoryOrderRepository(
  seed: readonly Order[] = SAMPLE_ORDERS,
): OrderRepository {
  const store = new Map<string, Order>();
  for (const order of seed) {
    store.set(order.id, cloneOrder(order));
  }

  return {
    list() {
      return [...store.values()].map(cloneOrder);
    },
    getById(id: string) {
      const key = canonicalOrderId(id) ?? id.toUpperCase();
      const order = store.get(key);
      return order ? cloneOrder(order) : null;
    },
    setStatus(id: string, status: OrderStatus) {
      const key = canonicalOrderId(id) ?? id.toUpperCase();
      const existing = store.get(key);
      if (!existing) return null;
      const updated: Order = { ...existing, status };
      store.set(key, updated);
      return cloneOrder(updated);
    },
    reset() {
      store.clear();
      for (const order of seed) {
        store.set(order.id, cloneOrder(order));
      }
    },
  };
}

/**
 * Process-wide singleton used by the route handlers. Serverless instances are
 * ephemeral, so the client also tracks executed actions and sends them with
 * each turn; duplicate detection therefore does not rely on server memory.
 */
export const orderRepository: OrderRepository =
  createInMemoryOrderRepository();
