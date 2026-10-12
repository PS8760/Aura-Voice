import { orderRepository } from "@/lib/domain/orders";
import { ConversationOrchestrator } from "@/lib/domain/orchestrator";

/**
 * Process-wide deterministic engine used by the route handlers. It is pure
 * TypeScript with no external dependencies, so the same logic also runs in the
 * browser as a graceful fallback when the API is unreachable.
 */
export const orchestrator = new ConversationOrchestrator(orderRepository);
