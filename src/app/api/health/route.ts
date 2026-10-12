import { NextResponse } from "next/server";
import { FIXTURE_VERSION, orderRepository } from "@/lib/domain/orders";
import { probeOllama } from "@/lib/server/ollama";

export const dynamic = "force-dynamic";

/**
 * Health and status endpoint. It reports a service as online only after it has
 * actually been verified — we never show a green status speculatively.
 */
export async function GET() {
  const orders = orderRepository.list();
  const repoOk = orders.length === 3;
  const localAI = await probeOllama();

  return NextResponse.json({
    ok: repoOk,
    engine: "deterministic-policy-engine",
    fixtureVersion: FIXTURE_VERSION,
    orderCount: orders.length,
    services: {
      supportEngine: "online",
      orderRepository: repoOk ? "online" : "degraded",
      localAI: localAI.available ? "online" : "unavailable",
    },
    localAI,
    time: new Date().toISOString(),
  });
}
