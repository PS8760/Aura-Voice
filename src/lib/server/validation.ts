import { z } from "zod";
import {
  INTENTS,
  RESOLUTION_STATUSES,
  executedActionSchema,
} from "../domain/outcome";
import { LOCALES } from "../domain/locale";
import type { Intent, ResolutionStatus } from "../domain/types";

const intentEnum = z.enum(INTENTS as unknown as [Intent, ...Intent[]]);
const resolutionEnum = z.enum(
  RESOLUTION_STATUSES as unknown as [ResolutionStatus, ...ResolutionStatus[]],
);
const localeEnum = z.enum(LOCALES as unknown as [string, ...string[]]);

export const sessionStateSchema = z.object({
  pending: z.enum(["order_action", "order_id", "verify_order_id"]).nullable(),
  orderId: z.string().nullable(),
  intent: intentEnum.nullable(),
  resolution: resolutionEnum.nullable(),
  unresolved: z.array(z.string()).max(50),
  actions: z.array(executedActionSchema).max(50),
  lastSummary: z.string().nullable(),
  turnCount: z.number().int().nonnegative(),
  clarificationAttempts: z.number().int().nonnegative(),
});

export const turnRequestSchema = z.object({
  text: z.string().min(1).max(2000),
  state: sessionStateSchema.optional(),
  mode: z
    .enum(["browser-voice", "local-ai", "text-fallback", "scenario"])
    .optional(),
  locale: localeEnum.optional(),
  /**
   * Recent conversation turns, oldest first, capped to keep prompts small.
   * The server is stateless, so the client replays a short window of context
   * for the local model. It never affects the deterministic policy engine.
   */
  history: z
    .array(
      z.object({
        role: z.enum(["customer", "agent"]),
        text: z.string().max(2000),
      }),
    )
    .max(12)
    .optional(),
});

export const outcomeRequestSchema = z.object({
  state: sessionStateSchema,
  mode: z
    .enum(["browser-voice", "local-ai", "text-fallback", "scenario"])
    .optional(),
  locale: localeEnum.optional(),
  /** Aria's final reply, captured to prefill admin knowledge suggestions. */
  lastReply: z.string().max(2000).optional(),
  /** Client-observed agent behaviour for this session. */
  agentMetrics: z
    .object({
      turns: z.number().int().nonnegative(),
      aiTurns: z.number().int().nonnegative(),
      acceptedDrafts: z.number().int().nonnegative(),
      rejectedDrafts: z.number().int().nonnegative(),
    })
    .optional(),
});

export type TurnRequest = z.infer<typeof turnRequestSchema>;
export type OutcomeRequest = z.infer<typeof outcomeRequestSchema>;
