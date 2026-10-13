import { createInMemoryOrderRepository } from "@/lib/domain/orders";
import {
  ConversationOrchestrator,
  type SessionState,
  type TurnResult,
} from "@/lib/domain/orchestrator";
import { DEFAULT_LOCALE, type Locale } from "@/lib/domain/locale";
import type { CallMode, CallOutcome } from "@/lib/domain/outcome";

export type InteractionMode = CallMode;

export type TransportSource = "server" | "local";

export interface HistoryTurn {
  role: "customer" | "agent";
  text: string;
}

export interface TurnResponse {
  ok: boolean;
  aiUsed: boolean;
  result?: TurnResult;
  message?: string;
  source: TransportSource;
  /** Present only when the server used the local-model agent path. */
  agent?: {
    steps: number;
    toolCalls: string[];
    acceptedDraft: boolean;
    rejectedDraft?: boolean;
  };
}

export interface OutcomeResponse {
  ok: boolean;
  outcome?: CallOutcome;
  message?: string;
  source: TransportSource;
}

export interface AgentMetricsPayload {
  turns: number;
  aiTurns: number;
  acceptedDrafts: number;
  rejectedDrafts: number;
}

export interface HealthPayload {
  ok: boolean;
  engine: string;
  fixtureVersion: string;
  orderCount: number;
  services: {
    supportEngine: string;
    orderRepository: string;
    localAI: string;
  };
  localAI: {
    enabled: boolean;
    available: boolean;
    endpoint: string;
    model: string;
    models: string[];
    note: string;
  };
  time: string;
}

/*
 * A client-side instance of the deterministic engine.
 *
 * The exact same TypeScript runs on the server. Keeping a local instance means
 * the workspace still works — genuinely, not as a simulation — if the API is
 * unreachable. Ollama is never involved on this path.
 */
const localRepo = createInMemoryOrderRepository();
const localEngine = new ConversationOrchestrator(localRepo);

export function resetLocalEngine(): void {
  localRepo.reset();
}

export function agentGreeting(locale: Locale = DEFAULT_LOCALE): string {
  return localEngine.greeting(locale);
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function requestTurn(
  text: string,
  state: SessionState,
  mode: InteractionMode,
  locale: Locale = DEFAULT_LOCALE,
  history: HistoryTurn[] = [],
): Promise<TurnResponse> {
  try {
    const response = await fetch("/api/support/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, state, mode, locale, history }),
    });
    const body = (await parseJsonSafe(response)) as
      | {
          ok: true;
          aiUsed: boolean;
          result: TurnResult;
          agent?: {
            steps: number;
            toolCalls: string[];
            acceptedDraft: boolean;
            rejectedDraft?: boolean;
          };
        }
      | { ok: false; message?: string }
      | null;

    if (response.ok && body && body.ok) {
      return {
        ok: true,
        aiUsed: body.aiUsed,
        result: body.result,
        agent: body.agent,
        source: "server",
      };
    }
    throw new Error(body && "message" in body ? body.message : "turn failed");
  } catch {
    // Serverless API unreachable or returned an error: use the in-browser
    // deterministic engine. This is a real engine, not a scripted fallback.
    try {
      const result = localEngine.processTurn(text, state, { locale });
      return { ok: true, aiUsed: false, result, source: "local" };
    } catch (error) {
      return {
        ok: false,
        aiUsed: false,
        source: "local",
        message:
          error instanceof Error
            ? error.message
            : "The support engine could not process that turn.",
      };
    }
  }
}

export async function requestOutcome(
  state: SessionState,
  mode: InteractionMode,
  locale: Locale = DEFAULT_LOCALE,
  extras: { lastReply?: string | null; agentMetrics?: AgentMetricsPayload | null } = {},
): Promise<OutcomeResponse> {
  try {
    const response = await fetch("/api/support/outcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state,
        mode,
        locale,
        lastReply: extras.lastReply ?? undefined,
        agentMetrics: extras.agentMetrics ?? undefined,
      }),
    });
    const body = (await parseJsonSafe(response)) as
      | { ok: true; outcome: CallOutcome }
      | { ok: false; message?: string }
      | null;
    if (response.ok && body && body.ok) {
      return { ok: true, outcome: body.outcome, source: "server" };
    }
    throw new Error("outcome failed");
  } catch {
    try {
      return {
        ok: true,
        outcome: localEngine.buildOutcome(state, mode),
        source: "local",
      };
    } catch {
      return {
        ok: false,
        source: "local",
        message: "The call outcome could not be generated.",
      };
    }
  }
}

export async function requestHealth(): Promise<HealthPayload | null> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as HealthPayload;
  } catch {
    return null;
  }
}
