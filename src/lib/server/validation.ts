import { z } from "zod";
import {
  INTENTS,
  RESOLUTION_STATUSES,
  executedActionSchema,
} from "../domain/outcome";
import type { Intent, ResolutionStatus } from "../domain/types";

const intentEnum = z.enum(INTENTS as unknown as [Intent, ...Intent[]]);
const resolutionEnum = z.enum(
  RESOLUTION_STATUSES as unknown as [ResolutionStatus, ...ResolutionStatus[]],
);

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
});

export const outcomeRequestSchema = z.object({
  state: sessionStateSchema,
  mode: z
    .enum(["browser-voice", "local-ai", "text-fallback", "scenario"])
    .optional(),
});

export type TurnRequest = z.infer<typeof turnRequestSchema>;
export type OutcomeRequest = z.infer<typeof outcomeRequestSchema>;
