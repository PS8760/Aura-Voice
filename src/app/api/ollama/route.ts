import { NextResponse } from "next/server";
import { probeOllama } from "@/lib/server/ollama";

export const dynamic = "force-dynamic";

/** Status of the optional local Ollama connection. Never claims online if unverified. */
export async function GET() {
  const status = await probeOllama();
  return NextResponse.json({ ok: true, localAI: status });
}
