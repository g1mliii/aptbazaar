import { fetchOrderByToken } from "@/lib/orders/tracking";
import { getOrderStream } from "@/lib/orders/order-stream";

// Phase 6.0c: live order tracking over SSE. Gated by the same 128-bit token as the poll route — a
// bad/expired token returns 404 and never opens a stream. Valid tokens subscribe to the order-level
// channel, so every tracking link for the same order receives the same status fan-out. When the
// ORDER_STREAM Durable Object binding is absent (plain `next dev`, or before the DO is wired in
// deploy), return 503 so the client's EventSource errors out and falls back to the 20s poll.

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token } = await params;

  const order = await fetchOrderByToken(token);
  if (!order) {
    return new Response("Not found.", { status: 404 });
  }

  const stream = getOrderStream(order.id);
  if (!stream) {
    // No DO binding here; the client keeps polling.
    return new Response("Live updates unavailable.", { status: 503 });
  }

  const response = await stream.subscribe({
    orderStatus: order.order_status,
    paymentStatus: order.payment_status
  });
  // Belt-and-suspenders: ensure no edge/proxy caches the stream.
  response.headers.set("cache-control", "no-store");
  return response;
}
