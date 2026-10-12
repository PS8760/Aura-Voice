import { z } from "zod";
import type { Intent, ResolutionStatus } from "./types";

export const INTENTS: readonly Intent[] = [
  "ORDER_TRACKING",
  "RETURN_REQUEST",
  "CANCELLATION_REQUEST",
  "SHIPPING_QUERY",
  "COD_QUERY",
  "DAMAGED_PRODUCT",
  "GENERAL_PRODUCT_QUERY",
  "OUT_OF_SCOPE",
  "UNKNOWN",
] as const;

export const RESOLUTION_STATUSES: readonly ResolutionStatus[] = [
  "RESOLVED",
  "UNRESOLVED",
  "ESCALATION_REQUIRED",
  "OUT_OF_SCOPE",
] as const;

export const executedActionSchema = z.object({
  id: z.string(),
  type: z.enum([
    "ORDER_LOOKUP",
    "CANCELLATION",
    "RETURN_REQUEST",
    "DAMAGE_REPORT",
    "COD_CHECK",
    "SHIPPING_CHECK",
    "INFO_ONLY",
  ]),
  orderId: z.string().nullable(),
  status: z.enum(["executed", "not_executed", "blocked"]),
  detail: z.string(),
  at: z.string(),
});

export type ExecutedAction = z.infer<typeof executedActionSchema>;

/**
 * The validated post-call outcome. This is the minimum structure required by
 * the brief, extended with an honest record of what actually happened.
 */
export const callOutcomeSchema = z.object({
  customer_intent: z.enum(INTENTS as unknown as [Intent, ...Intent[]]),
  order_id: z.string().nullable(),
  resolution_status: z.enum(
    RESOLUTION_STATUSES as unknown as [ResolutionStatus, ...ResolutionStatus[]],
  ),
  call_summary: z.string().min(1),
  actions_executed: z.array(executedActionSchema),
  unresolved_issues: z.array(z.string()),
  generated_at: z.string(),
  mode: z.enum(["browser-voice", "local-ai", "text-fallback", "scenario"]),
});

export type CallOutcome = z.infer<typeof callOutcomeSchema>;

export interface OutcomeDraft {
  intent: Intent;
  orderId: string | null;
  resolution: ResolutionStatus;
  summary: string;
  actions: ExecutedAction[];
  unresolved: string[];
  mode: CallOutcome["mode"];
}

export function validateOutcome(
  value: unknown,
): { ok: true; data: CallOutcome } | { ok: false; errors: string[] } {
  const parsed = callOutcomeSchema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    ),
  };
}

/** Deterministically assemble a valid outcome from a draft. */
export function buildOutcome(
  draft: OutcomeDraft,
  now: () => Date = () => new Date(),
): CallOutcome {
  const candidate: CallOutcome = {
    customer_intent: draft.intent,
    order_id: draft.orderId,
    resolution_status: draft.resolution,
    call_summary: draft.summary.trim() || "No summary could be generated.",
    actions_executed: draft.actions,
    unresolved_issues: draft.unresolved,
    generated_at: now().toISOString(),
    mode: draft.mode,
  };
  const validated = validateOutcome(candidate);
  if (!validated.ok) {
    // Fail safe: never emit an invalid outcome. Fall back to a minimal, honest
    // record that names the validation failure instead of fabricating data.
    return {
      customer_intent: "UNKNOWN",
      order_id: null,
      resolution_status: "UNRESOLVED",
      call_summary:
        "The outcome could not be validated against the schema: " +
        validated.errors.join("; "),
      actions_executed: [],
      unresolved_issues: ["Outcome schema validation failed."],
      generated_at: now().toISOString(),
      mode: draft.mode,
    };
  }
  return validated.data;
}

export function outcomeToJson(outcome: CallOutcome): string {
  return JSON.stringify(outcome, null, 2);
}

export function outcomeToFileName(outcome: CallOutcome): string {
  const stamp = outcome.generated_at.replace(/[:.]/g, "-");
  return `aura-voice-cx-outcome-${stamp}.json`;
}

export function transcriptFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `aura-voice-cx-transcript-${stamp}.txt`;
}
