import { NextResponse } from "next/server";
import { orchestrator } from "@/lib/server/engine";
import { outcomeRequestSchema } from "@/lib/server/validation";

export const dynamic = "force-dynamic";

/** Build and validate the final outcome for a completed session. */
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

  const parsed = outcomeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_INPUT",
        message: "The outcome request failed runtime validation.",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  const { state, mode } = parsed.data;
  const outcome = orchestrator.buildOutcome(state, mode ?? "text-fallback");
  return NextResponse.json({ ok: true, outcome });
}
