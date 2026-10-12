import { NextResponse } from "next/server";
import { FIXTURE_VERSION, orderRepository } from "@/lib/domain/orders";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    fixtureVersion: FIXTURE_VERSION,
    mockDataNotice:
      "These are mock fixtures supplied for the assessment, not live logistics data.",
    orders: orderRepository.list(),
  });
}
