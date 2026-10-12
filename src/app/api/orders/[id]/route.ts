import { NextResponse } from "next/server";
import { orderRepository } from "@/lib/domain/orders";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const order = orderRepository.getById(id);

  if (!order) {
    return NextResponse.json(
      {
        ok: false,
        error: "ORDER_NOT_FOUND",
        message: `No mock order matches "${id}". The demo includes ORD-101, ORD-102 and ORD-103.`,
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, order });
}
