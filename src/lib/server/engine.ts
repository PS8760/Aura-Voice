import {
  createInMemoryOrderRepository,
  orderRepository,
  type OrderRepository,
} from "@/lib/domain/orders";
import { ConversationOrchestrator } from "@/lib/domain/orchestrator";
import type { ExecutedAction } from "@/lib/domain/outcome";

/**
 * The deterministic conversation engine used by the route handlers.
 *
 * It is pure TypeScript with no external dependencies, so the exact same
 * logic also runs in the browser as a graceful fallback when the API is
 * unreachable.
 */
export function createEngine(
  repo: OrderRepository = orderRepository,
  now: () => Date = () => new Date(),
): ConversationOrchestrator {
  return new ConversationOrchestrator(repo, now);
}

/** A shared instance for pure operations such as building an outcome. */
export const orchestrator = createEngine();

/**
 * Build an isolated repository for a single request.
 *
 * Serverless instances are ephemeral and can be shared between users, so we do
 * not rely on process memory for mock mutations. Instead the client sends the
 * actions it has already executed with every turn and we replay them onto a
 * fresh copy of the fixture data. This keeps cancellation idempotent and the
 * server genuinely stateless.
 */
export function createRequestRepository(
  actions: readonly ExecutedAction[] = [],
): OrderRepository {
  const repo = createInMemoryOrderRepository();
  for (const action of actions) {
    if (
      action.type === "CANCELLATION" &&
      action.status === "executed" &&
      action.orderId
    ) {
      repo.setStatus(action.orderId, "Cancelled");
    }
  }
  return repo;
}
