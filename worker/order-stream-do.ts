import { DurableObject } from "cloudflare:workers";

// Phase 6.0c: one Durable Object per order (getByName(orderId)). Watcher tabs subscribe over SSE
// after token validation; the seller's status/paid actions publish a change and the DO fans it out.
// In-memory only — the order state is always re-fetchable, so an eviction just forces a reconnect
// + poll. The 20s poll on the tracking page is the documented fallback, so nothing here is
// load-bearing.

type Payload = { orderStatus: string; paymentStatus: string };
type Env = Record<string, never>;

// Close streams that have sat idle this long; the client's EventSource auto-reconnects (and the
// poll covers the gap). Watcher counts per order are tiny, so no hibernation is needed.
const IDLE_MS = 5 * 60 * 1000;

// Phase 9.3: cap concurrent SSE streams per order. A real watcher has one tab; more than a handful
// means stale connections piling up (or abuse). At the cap we evict the oldest controller before
// admitting the new one, which also coalesces a fast reconnect — the dead stream is dropped, not
// stacked. The 20s poll covers any client we close.
const MAX_STREAMS = 5;

export class OrderStreamDO extends DurableObject<Env> {
  private controllers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private encoder = new TextEncoder();

  /** Open a new SSE stream, seed it with the current state, and refresh the idle alarm. */
  async subscribe(currentState: Payload): Promise<Response> {
    // Evict the oldest stream(s) so we never hold more than MAX_STREAMS for this order. Set
    // iteration is insertion-ordered, so the first entry is the oldest connection.
    while (this.controllers.size >= MAX_STREAMS) {
      const oldest = this.controllers.values().next().value;
      if (!oldest) break;
      this.controllers.delete(oldest);
      try {
        oldest.close();
      } catch {
        // Already closed.
      }
    }

    let ref: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        ref = controller;
        this.controllers.add(controller);
        controller.enqueue(this.frame(currentState));
      },
      cancel: () => {
        // The tab closed / navigated away. Drop just this connection's controller.
        if (ref) this.controllers.delete(ref);
      }
    });

    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive"
      }
    });
  }

  /** Fan a state change out to every open stream. Prunes any controller that's already closed.
   *  Sync over RPC — the binding stub resolves the call to a promise on the caller's side. */
  publish(payload: Payload): void {
    const frame = this.frame(payload);
    for (const controller of this.controllers) {
      try {
        controller.enqueue(frame);
      } catch {
        // Already closed — forget it.
        this.controllers.delete(controller);
      }
    }
  }

  /** Idle timeout: close every stream so clients reconnect fresh (or ride the poll). */
  override alarm(): void {
    for (const controller of this.controllers) {
      try {
        controller.close();
      } catch {
        // Already closed.
      }
    }
    this.controllers.clear();
  }

  private frame(payload: Payload): Uint8Array {
    return this.encoder.encode(`event: status\ndata:${JSON.stringify(payload)}\n\n`);
  }
}
