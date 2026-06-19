import { NextResponse } from "next/server";

import { fetchOrderByToken } from "@/lib/orders/tracking";

// Phase 4.6 (SSE deferred to Phase 6): the tracking page polls this for fresh status. Token-gated
// through get_order_by_token — a bad or expired token returns 404 and no data. Phase 6 replaces
// this poll with the Cloudflare Worker + Durable Object SSE stream at /api/track/[token]/stream.

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token } = await params;
  const order = await fetchOrderByToken(token);

  if (!order) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({
    orderStatus: order.order_status,
    paymentStatus: order.payment_status,
    pickupWindow: order.pickup_window,
    updatedAt: order.updated_at
  });
}
