import { NextResponse } from "next/server";
import { classifyIntent } from "@/lib/domain/intent";
import { initialSessionState } from "@/lib/domain/orchestrator";
import { createEngine, createRequestRepository } from "@/lib/server/engine";
import { classifyWithOllama, localAiEnabled } from "@/lib/server/ollama";
import { turnRequestSchema } from "@/lib/server/validation";

export const dynamic = "force-dynamic";

/**
 * Server-side turn endpoint: intent recognition, tool execution, policy
 * enforcement and response construction all happen here.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON", message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = turnRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_INPUT",
        message: "The turn request failed runtime validation.",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  const { text, state } = parsed.data;
  const base = state ?? initialSessionState();

  let aiUsed = false;
  let override: { intent: ReturnType<typeof classifyIntent>["intent"] } | undefined;

  // Optional local-AI assist: only for utterances the deterministic classifier
  // could not place, and only to propose an intent. Policy stays in code.
  if (localAiEnabled()) {
    const classification = classifyIntent(text);
    if (classification.intent === "UNKNOWN" && !classification.needsClarification) {
      const proposed = await classifyWithOllama(text);
      if (proposed && proposed !== "UNKNOWN") {
        aiUsed = true;
        override = { intent: proposed };
      }
    }
  }

  try {
    // Stateless execution: replay previously executed mock actions onto a fresh
    // fixture copy so lookups reflect this session without shared server state.
    const engine = createEngine(createRequestRepository(base.actions));
    const result = engine.processTurn(text, base, override);
    return NextResponse.json({ ok: true, aiUsed, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "ENGINE_ERROR",
        message:
          "The support engine failed to process this turn. You can continue using the browser fallback engine.",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 },
    );
  }
}
