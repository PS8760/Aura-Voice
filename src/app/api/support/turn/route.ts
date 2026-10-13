import { NextResponse } from "next/server";
import { initialSessionState } from "@/lib/domain/orchestrator";
import { classifyIntent } from "@/lib/domain/intent";
import { toLocale } from "@/lib/domain/locale";
import { runSupportAgent } from "@/lib/server/agent";
import { getRepositories } from "@/lib/server/db/repositories";
import { createEngine, createRequestRepository } from "@/lib/server/engine";
import { DEFAULT_COMPANY_ID, retrievePassages } from "@/lib/server/rag";
import type { RetrievedPassage } from "@/lib/server/rag";
import { turnRequestSchema } from "@/lib/server/validation";

export const dynamic = "force-dynamic";

/**
 * Server-side turn endpoint.
 *
 * Preferred path: the enterprise agent (local model for understanding, code for
 * every decision). If no local model is reachable, or the agent fails its
 * guardrails, we fall back to the pure deterministic engine so a turn is always
 * answered honestly.
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

  const { text, state, locale: rawLocale, history } = parsed.data;
  const locale = toLocale(rawLocale);
  const base = state ?? initialSessionState();

  try {
    // Stateless execution: replay previously executed mock actions onto a fresh
    // fixture copy so lookups reflect this session without shared server state.
    const repo = createRequestRepository(base.actions);

    // Retrieve grounded context for this utterance (best-effort):
    //  - `knowledge`: approved Q/A answers injected into the agent prompt.
    //  - `passages`: hybrid-retrieved, cited passages from the tenant knowledge
    //    base (policy + FAQ + approved knowledge), used by the RAG path.
    // Both are boosted toward the detected intent and the active locale.
    let knowledge: { question: string; answer: string }[] = [];
    let passages: RetrievedPassage[] = [];
    try {
      const stores = await getRepositories();
      const intent = classifyIntent(text).intent;
      const [entries, approved] = await Promise.all([
        stores.knowledge.search(text, { intent, locale }),
        stores.knowledge.list({ approvedOnly: true }),
      ]);
      knowledge = entries.map((entry) => ({ question: entry.question, answer: entry.answer }));
      for (const entry of entries) void stores.knowledge.incrementUsage(entry.id);
      passages = await retrievePassages(text, {
        intent,
        locale,
        companyId: DEFAULT_COMPANY_ID,
        knowledge: approved,
      });
    } catch {
      knowledge = [];
      passages = [];
    }

    const agent = await runSupportAgent({
      text,
      state: base,
      repo,
      locale,
      knowledge,
      passages,
      history,
    });
    if (agent) {
      return NextResponse.json({
        ok: true,
        aiUsed: true,
        result: agent.result,
        agent: {
          steps: agent.metrics.steps,
          toolCalls: agent.metrics.toolCalls,
          acceptedDraft: agent.metrics.acceptedDraft,
          rejectedDraft: agent.metrics.rejectedDraft,
          understanding: agent.metrics.understanding,
          citations: agent.metrics.citations,
        },
        passages: passages.map((p) => ({
          id: p.id,
          title: p.title,
          source: p.source,
          score: Number(p.score.toFixed(4)),
        })),
      });
    }

    const engine = createEngine(createRequestRepository(base.actions));
    const result = engine.processTurn(text, base, { locale });
    return NextResponse.json({ ok: true, aiUsed: false, result });
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
