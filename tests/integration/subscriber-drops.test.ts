import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  authedClient,
  cleanupUser,
  seedSeller,
  serviceClient,
  type Db,
  type SeededSeller
} from "./helpers/clients";
import {
  countActiveRecipients,
  loadActiveRecipients
} from "@/lib/subscribers/recipients";
import { generateToken } from "@/lib/utils/token";

// server-only is a build-time guard; stub it so the Node integration runner can import the
// production helpers (unsubscribeByToken / writeAuditLog use the secret client).
vi.mock("server-only", () => ({}));

// Phase 6.5 regression: the new owner-DELETE RLS policy (migration 0032), the drop-eligible
// recipient filter (verified_at not null AND unsubscribed_at null — same predicate as
// subscribers_store_active_drop_idx), and the idempotent + audit-logged unsubscribe-by-token path.
// Requires migration 0032 applied to the target project.

const service = serviceClient();

let sellerA: SeededSeller;
let sellerB: SeededSeller;
let clientA: Db;

beforeAll(async () => {
  // The secret client (used by unsubscribeByToken) reads its own env names; point them at the same
  // project the integration helpers use so both talk to one database.
  process.env.NEXT_PUBLIC_SUPABASE_URL ??=
    process.env.SUPABASE_URL ?? process.env.API_URL ?? "http://127.0.0.1:54321";
  process.env.SUPABASE_SECRET_KEY ??=
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "";

  sellerA = await seedSeller(service, { slug: `subA-${Date.now()}` });
  sellerB = await seedSeller(service, { slug: `subB-${Date.now()}` });
  clientA = await authedClient(sellerA.email, sellerA.password);
});

afterAll(async () => {
  await cleanupUser(service, sellerA.userId);
  await cleanupUser(service, sellerB.userId);
});

/** Seed a subscriber with explicit drop-eligibility state. */
async function seedSubscriber(
  storeId: string,
  opts: { verified: boolean; unsubscribed: boolean }
): Promise<{ id: string; token: string; email: string }> {
  const token = generateToken();
  const email = `fan-${generateToken().slice(0, 8)}@example.test`;
  const { data, error } = await service
    .from("subscribers")
    .insert({
      store_id: storeId,
      email,
      consent_email: true,
      unsubscribe_token: token,
      verified_at: opts.verified ? new Date().toISOString() : null,
      unsubscribed_at: opts.unsubscribed ? new Date().toISOString() : null
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed subscriber failed: ${error?.message}`);
  return { id: data.id, token, email };
}

describe("subscribers_owner_delete RLS", () => {
  it("lets an owner delete their own subscriber", async () => {
    const sub = await seedSubscriber(sellerA.storeId, {
      verified: true,
      unsubscribed: false
    });
    const { error } = await clientA.from("subscribers").delete().eq("id", sub.id);
    expect(error).toBeNull();

    const { data } = await service
      .from("subscribers")
      .select("id")
      .eq("id", sub.id)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it("denies deleting another tenant's subscriber", async () => {
    const sub = await seedSubscriber(sellerB.storeId, {
      verified: true,
      unsubscribed: false
    });
    // RLS makes the row invisible to A — the delete matches zero rows (no error, no effect).
    await clientA.from("subscribers").delete().eq("id", sub.id);

    const { data } = await service
      .from("subscribers")
      .select("id")
      .eq("id", sub.id)
      .maybeSingle();
    expect(data?.id).toBe(sub.id); // still there
  });
});

describe("loadActiveRecipients", () => {
  it("returns only verified, not-unsubscribed subscribers", async () => {
    const fresh = await seedSeller(service, { slug: `subR-${Date.now()}` });
    const active = await seedSubscriber(fresh.storeId, {
      verified: true,
      unsubscribed: false
    });
    await seedSubscriber(fresh.storeId, { verified: true, unsubscribed: true });
    await seedSubscriber(fresh.storeId, { verified: false, unsubscribed: false });

    const recipients = await loadActiveRecipients(service, fresh.storeId);
    const emails = recipients.map((r) => r.email);
    expect(emails).toContain(active.email);
    expect(emails).toHaveLength(1);
    await expect(countActiveRecipients(service, fresh.storeId)).resolves.toBe(1);

    await cleanupUser(service, fresh.userId);
  });
});

describe("unsubscribeByToken", () => {
  it("is idempotent and audit-logs only the first unsubscribe", async () => {
    const { unsubscribeByToken } = await import("@/lib/subscribers/unsubscribe");
    const sub = await seedSubscriber(sellerA.storeId, {
      verified: true,
      unsubscribed: false
    });

    const first = await unsubscribeByToken(sub.token);
    expect(first.ok).toBe(true);

    const { data: afterFirst } = await service
      .from("subscribers")
      .select("unsubscribed_at")
      .eq("id", sub.id)
      .single();
    expect(afterFirst?.unsubscribed_at).not.toBeNull();
    const firstStamp = afterFirst?.unsubscribed_at;

    // Second call (a refresh, or the one-click POST after the body-link GET) changes nothing.
    const second = await unsubscribeByToken(sub.token);
    expect(second.ok).toBe(true);
    const { data: afterSecond } = await service
      .from("subscribers")
      .select("unsubscribed_at")
      .eq("id", sub.id)
      .single();
    expect(afterSecond?.unsubscribed_at).toBe(firstStamp);

    const { data: audits } = await service
      .from("audit_log")
      .select("id")
      .eq("action", "subscriber.unsubscribed")
      .eq("target_id", sub.id);
    expect(audits).toHaveLength(1);
  });

  it("returns not-ok for an unknown token", async () => {
    const { unsubscribeByToken } = await import("@/lib/subscribers/unsubscribe");
    const res = await unsubscribeByToken(generateToken());
    expect(res.ok).toBe(false);
  });
});
