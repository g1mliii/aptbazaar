"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit/log";
import { sendDropEmail } from "@/lib/email/drop";
import { appBaseUrl } from "@/lib/env";
import { requireSeller } from "@/lib/auth/session";
import { addToWindows, getRateLimitKv } from "@/lib/ratelimit/kv";
import { fieldErrorsFrom } from "@/lib/schemas/field-errors";
import { dropInputSchema, subscriberInputSchema } from "@/lib/schemas/subscriber";
import {
  DROP_DAILY_LIMIT,
  DROP_PLATFORM_DAILY_LIMIT,
  dropPlatformWindowKey,
  dropWindowKey,
  secondsUntilUtcMidnight
} from "@/lib/subscribers/drop-window";
import { loadActiveRecipients } from "@/lib/subscribers/recipients";
import { createSupabaseAnonClient } from "@/lib/supabase/anon";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/utils/csv";
import { generateToken } from "@/lib/utils/token";

// Phase 4.10: storefront subscriber capture. Anon inserts into `subscribers` for an active store
// (RLS policy subscribers_anon_insert). No phone / SMS in v1. A fresh unsubscribe_token rides
// along so the drop emails can carry a one-click unsubscribe link.
//
// Phase 6.5: the consent checkbox is the opt-in (decision: v1 single opt-in), so we stamp
// verified_at at capture — that's what marks a row drop-eligible (the partial index
// subscribers_store_active_drop_idx filters on verified_at IS NOT NULL).
//
// Hard per-(ip, store) rate limiting is Phase 9.3 — the seam is here, not the implementation.

export type SubscribeResult =
  | { ok: true }
  | { ok: false; fieldErrors?: Record<string, string>; error?: string };

export async function subscribe(input: unknown): Promise<SubscribeResult> {
  const parsed = subscriberInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const supabase = createSupabaseAnonClient();
  const { error } = await supabase.from("subscribers").insert({
    store_id: parsed.data.storeId,
    email: parsed.data.email,
    consent_email: parsed.data.consentEmail,
    unsubscribe_token: generateToken(),
    verified_at: new Date().toISOString()
  });

  // Already on the list (UNIQUE(store_id, email)). Anon can't SELECT subscribers to confirm,
  // so treat a duplicate as success — the visitor's intent is satisfied either way, and we
  // don't reveal whether the address was already captured.
  if (error && error.code !== "23505") {
    return { ok: false, error: "We couldn't add you just now. Try again in a moment." };
  }

  return { ok: true };
}

// Phase 6.5: the seller-side drop send + roster management. These run from the dashboard and derive
// the seller from the session (requireSeller) — never a store/seller id from the client.

const SEND_BATCH_SIZE = 20;
const DROP_RECIPIENT_QUERY_LIMIT = DROP_DAILY_LIMIT + 1;

export type SendDropResult =
  | { ok: true; sent: number }
  | { ok: false; fieldErrors?: Record<string, string>; error?: string };

export async function sendDrop(input: unknown): Promise<SendDropResult> {
  const seller = await requireSeller();

  const parsed = dropInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }
  const { subject, body } = parsed.data;

  // Anti-spam: the sender's physical mailing address is legally required in a commercial broadcast,
  // and there is no platform fallback — the seller must add their own.
  const contactAddress = seller.contact_address;
  if (!contactAddress) {
    return {
      ok: false,
      error: "Add your mailing address in Settings before sending drops."
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data: store } = await supabase
    .from("stores")
    .select("id, name")
    .eq("seller_id", seller.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!store) {
    return { ok: false, error: "Set up your store before sending drops." };
  }

  // Owner SELECT under RLS — recipients are the verified, not-unsubscribed list. Load at most one
  // past the daily cap so a large list is rejected without materializing it into memory.
  let recipients;
  try {
    recipients = await loadActiveRecipients(
      supabase,
      store.id,
      DROP_RECIPIENT_QUERY_LIMIT
    );
  } catch {
    return {
      ok: false,
      error: "We couldn't load your subscribers. Try again in a moment."
    };
  }
  if (recipients.length === 0) {
    return { ok: false, error: "You don't have any active subscribers yet." };
  }
  if (recipients.length > DROP_DAILY_LIMIT) {
    return {
      ok: false,
      error: `Today's limit is ${DROP_DAILY_LIMIT} drop emails. Your active list is bigger than that.`
    };
  }

  // Per-store + platform daily caps (KV fixed windows). The whole batch is reserved up front so
  // concurrent sends can't both squeak past the limits. KV is null under plain `next dev` / tests →
  // fail open, same soft-control contract as the magic-link limiter.
  const now = Date.now();
  const kv = getRateLimitKv();
  if (kv) {
    const windowSeconds = secondsUntilUtcMidnight(now);
    const limit = await addToWindows(kv, [
      {
        key: dropWindowKey(store.id, now),
        amount: recipients.length,
        limit: DROP_DAILY_LIMIT,
        windowSeconds
      },
      {
        key: dropPlatformWindowKey(now),
        amount: recipients.length,
        limit: DROP_PLATFORM_DAILY_LIMIT,
        windowSeconds
      }
    ]);
    if (!limit.allowed) {
      if (limit.key.startsWith("drop:platform:")) {
        return {
          ok: false,
          error: "Stoop's drop email limit is full for today. Try again tomorrow."
        };
      }

      return {
        ok: false,
        error: `You've reached today's limit of ${DROP_DAILY_LIMIT} emails. Try again tomorrow.`
      };
    }
  }

  console.info(
    JSON.stringify({
      metric: "drop.sent",
      store_id: store.id,
      recipient_count: recipients.length
    })
  );

  const host = appBaseUrl();
  let sent = 0;
  for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
    const batch = recipients.slice(i, i + SEND_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((r) =>
        sendDropEmail({
          to: r.email,
          storeName: store.name,
          sellerDisplayName: seller.display_name,
          contactAddress,
          subject,
          bodyText: body,
          unsubscribeUrl: `${host}/u/${r.unsubscribe_token}`,
          oneClickUrl: `${host}/api/unsubscribe/${r.unsubscribe_token}`
        })
      )
    );
    sent += results.filter((x) => x.status === "fulfilled").length;
  }

  if (sent === 0) {
    return { ok: false, error: "We couldn't send that drop. Try again in a moment." };
  }

  await writeAuditLog({
    actorType: "seller",
    actorId: seller.user_id,
    action: "drop.sent",
    targetTable: "stores",
    targetId: store.id,
    payload: { subject, recipient_count: recipients.length, sent_count: sent }
  });

  return { ok: true, sent };
}

export type RemoveSubscriberResult = { ok: true } | { ok: false; error: string };

/** Remove one subscriber from the seller's roster. The delete runs under the seller's own JWT —
 *  the subscribers_owner_delete RLS policy (migration 0032) is the tenant guard. */
export async function removeSubscriber(
  subscriberId: unknown
): Promise<RemoveSubscriberResult> {
  const seller = await requireSeller();

  const parsed = z.string().uuid().safeParse(subscriberId);
  if (!parsed.success) {
    return { ok: false, error: "We couldn't find that subscriber." };
  }
  const id = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("subscribers")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      error: "We couldn't remove that subscriber. Try again in a moment."
    };
  }

  await writeAuditLog({
    actorType: "seller",
    actorId: seller.user_id,
    action: "subscriber.removed",
    targetTable: "subscribers",
    targetId: id
  });

  revalidatePath("/dashboard/subscribers");
  return { ok: true };
}

export type ExportSubscribersCsvResult =
  | { ok: true; filename: string; csv: string }
  | { ok: false; error: string };

type SubscriberExportRow = {
  email: string;
  verified_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
};

const EXPORT_PAGE_SIZE = 1000;

function csvStatus(row: SubscriberExportRow): string {
  return row.verified_at !== null && row.unsubscribed_at === null
    ? "active"
    : "unsubscribed";
}

export async function exportSubscribersCsv(): Promise<ExportSubscribersCsvResult> {
  const seller = await requireSeller();
  const supabase = await createSupabaseServerClient();
  const { data: store } = await supabase
    .from("stores")
    .select("id, slug")
    .eq("seller_id", seller.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!store) {
    return { ok: false, error: "Set up your store before exporting subscribers." };
  }

  const rows: SubscriberExportRow[] = [];
  for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
    const to = from + EXPORT_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("subscribers")
      .select("email, verified_at, unsubscribed_at, created_at")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      return {
        ok: false,
        error: "We couldn't export your subscribers. Try again in a moment."
      };
    }

    rows.push(...(data ?? []));
    if (!data || data.length < EXPORT_PAGE_SIZE) break;
  }

  const csv = toCsv(rows, [
    { header: "email", value: (s) => s.email },
    { header: "joined", value: (s) => s.created_at },
    { header: "status", value: csvStatus }
  ]);

  return { ok: true, filename: `subscribers-${store.slug}.csv`, csv };
}
