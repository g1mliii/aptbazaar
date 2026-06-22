import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

// Phase 6.0c: the publish/subscribe seam for live order tracking. One Durable Object per order
// (getByName(orderId)). The seller's status/paid actions publish a change; watcher tabs subscribe
// through the stream route after the token has been validated. Everything here is best-effort: the
// 20s poll on the tracking page is the documented fallback, so a missing binding (plain `next dev`)
// or a transient DO error must never fail the underlying mutation.

export type OrderStreamPayload = {
  orderStatus: string;
  paymentStatus: string;
};

export interface OrderStreamStub {
  publish(payload: OrderStreamPayload): Promise<void>;
  subscribe(currentState: OrderStreamPayload): Promise<Response>;
}

interface OrderStreamNamespace {
  getByName(name: string): OrderStreamStub;
}

/** The ORDER_STREAM DO namespace, or null outside the Worker runtime (e.g. `next dev`). */
export function getOrderStream(orderId: string): OrderStreamStub | null {
  try {
    const { env } = getCloudflareContext();
    const ns = (env as { ORDER_STREAM?: OrderStreamNamespace }).ORDER_STREAM;
    return ns ? ns.getByName(orderId) : null;
  } catch {
    return null;
  }
}

/** Best-effort publish to an order's watchers. No-ops when the binding is absent. */
export async function publishOrderUpdate(
  orderId: string,
  payload: OrderStreamPayload
): Promise<void> {
  const stub = getOrderStream(orderId);
  if (!stub) return;
  try {
    await stub.publish(payload);
  } catch {
    // Watchers fall back to the poll; a publish miss is not fatal.
  }
}
