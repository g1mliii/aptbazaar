import { describe, expect, it } from "vitest";

import {
  canonicalizeOrderRequest,
  orderRequestHash
} from "@/lib/orders/request-hash";
import type { OrderPlacement } from "@/lib/schemas/order";

// Phase 4.4: the request hash is the idempotency body-gate. These tests pin the two properties
// that make it a security control: (1) the SAME logical order always hashes the same regardless
// of item encoding order / email casing, so a legitimate retry replays; (2) a DIFFERENT order
// hashes differently, so a reused idempotency key with a different body is rejected (and the
// original order's tracking token never leaks).

const base: OrderPlacement = {
  storeId: "11111111-1111-1111-1111-111111111111",
  customerName: "Sam",
  customerEmail: "Sam@Example.com",
  paymentMode: "pay_at_pickup",
  idempotencyKey: "22222222-2222-2222-2222-222222222222",
  items: [
    { productId: "aaaaaaaa-0000-0000-0000-000000000001", quantity: 2 },
    { productId: "bbbbbbbb-0000-0000-0000-000000000002", quantity: 1 }
  ]
};

describe("canonicalizeOrderRequest", () => {
  it("is stable across item ordering", () => {
    const reordered: OrderPlacement = {
      ...base,
      items: [...base.items].reverse()
    };
    expect(canonicalizeOrderRequest(reordered)).toBe(
      canonicalizeOrderRequest(base)
    );
  });

  it("normalizes email casing and whitespace", () => {
    const messyEmail: OrderPlacement = {
      ...base,
      customerEmail: "  sam@example.com  "
    };
    expect(canonicalizeOrderRequest(messyEmail)).toBe(
      canonicalizeOrderRequest(base)
    );
  });

  it("ignores fields that don't define the order (name, phone, notes, key)", () => {
    const cosmetic: OrderPlacement = {
      ...base,
      customerName: "A Different Name",
      customerPhoneE164: "+14165550140",
      notes: "leave at the door",
      idempotencyKey: "99999999-9999-9999-9999-999999999999"
    };
    expect(canonicalizeOrderRequest(cosmetic)).toBe(
      canonicalizeOrderRequest(base)
    );
  });

  it("changes when a quantity changes", () => {
    const moreCookies: OrderPlacement = {
      ...base,
      items: [{ ...base.items[0]!, quantity: 99 }, base.items[1]!]
    };
    expect(canonicalizeOrderRequest(moreCookies)).not.toBe(
      canonicalizeOrderRequest(base)
    );
  });

  it("changes when the store changes", () => {
    const otherStore: OrderPlacement = {
      ...base,
      storeId: "33333333-3333-3333-3333-333333333333"
    };
    expect(canonicalizeOrderRequest(otherStore)).not.toBe(
      canonicalizeOrderRequest(base)
    );
  });
});

describe("orderRequestHash", () => {
  it("is a 64-char hex sha-256", async () => {
    const hash = await orderRequestHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches for equivalent orders and differs for different ones", async () => {
    const equivalent: OrderPlacement = {
      ...base,
      customerEmail: "SAM@example.com",
      items: [...base.items].reverse()
    };
    const different: OrderPlacement = {
      ...base,
      items: [{ ...base.items[0]!, quantity: 3 }, base.items[1]!]
    };
    expect(await orderRequestHash(equivalent)).toBe(await orderRequestHash(base));
    expect(await orderRequestHash(different)).not.toBe(
      await orderRequestHash(base)
    );
  });
});
