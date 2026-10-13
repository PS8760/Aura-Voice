import { NextResponse } from "next/server";
import { toLocale } from "@/lib/domain/locale";
import {
  getRepositories,
  sessionFromOutcome,
} from "@/lib/server/db/repositories";
import { orchestrator } from "@/lib/server/engine";
import { getAppUser } from "@/lib/server/userContext";
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

  const { state, mode, locale, lastReply, agentMetrics } = parsed.data;
  const outcome = orchestrator.buildOutcome(state, mode ?? "text-fallback");

  // Persist the session when a user is signed in. Storage is best-effort: a
  // database hiccup must never stop the customer from seeing their outcome.
  let persisted = false;
  try {
    const user = await getAppUser();
    if (user) {
      const repo = await getRepositories();
      const resolvedLocale = toLocale(locale);
      await repo.sessions.save(
        sessionFromOutcome(outcome, {
          userId: user.userId,
          userEmail: user.email,
          locale: resolvedLocale,
          turnCount: state.turnCount,
          lastReply,
          agentMetrics: agentMetrics ?? null,
        }),
      );
      persisted = true;

      // Learning loop: turn unresolved / escalated / out-of-scope sessions into
      // pending knowledge suggestions. Aria's last reply is captured as a
      // starting draft so a human only has to edit and approve it. Nothing is
      // ever used in a live reply until it is approved in the admin portal.
      if (outcome.resolution_status !== "RESOLVED") {
        const question = outcome.call_summary.slice(0, 300);
        const existing = await repo.knowledge.list();
        if (question.trim() && !existing.some((k) => k.question === question)) {
          await repo.knowledge.create({
            question,
            answer: (lastReply ?? "").trim(),
            intent: outcome.customer_intent,
            locale: resolvedLocale,
            source: "session",
            approved: false,
            createdBy: "system",
          });
        }
      }
    }
  } catch {
    persisted = false;
  }

  return NextResponse.json({ ok: true, outcome, persisted });
}
