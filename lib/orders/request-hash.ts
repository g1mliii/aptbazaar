import type { OrderPlacement } from "@/lib/schemas/order";

// Phase 4.4: the request hash is the second idempotency gate. The first is the
// UNIQUE(store_id, idempotency_key) row guard; the hash makes a reused key only replay when the
// body is byte-identical, which defeats token exfiltration by a guessed key. Kept pure (no
// server-only imports) so it can be unit-tested directly.

/**
 * Canonical JSON for an order request. Items are sorted by productId and the email is
 * normalized, so neither encoding order nor casing changes the hash for the same logical order.
 */
export function canonicalizeOrderRequest(input: OrderPlacement): string {
  const items = input.items
    .map((i) => ({ productId: i.productId, quantity: i.quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
  return JSON.stringify({
    storeId: input.storeId,
    customerEmail: input.customerEmail.trim().toLowerCase(),
    paymentMode: input.paymentMode,
    items
  });
}

/** SHA-256 hex of the canonicalized request. Web Crypto so it runs on Workers, Node, and tests. */
export async function orderRequestHash(input: OrderPlacement): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeOrderRequest(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
