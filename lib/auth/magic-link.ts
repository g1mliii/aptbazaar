"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { requiredEnv } from "@/lib/env";
import { getRateLimitKv, incrementWithTtl } from "@/lib/ratelimit/kv";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Phase 2.7: magic-link issuance, rate-limited in our own server action because the
// Supabase OTP endpoint lives on Supabase's domain (Cloudflare can't see that traffic).
// Limits: 5/min per email, 20/hour per IP. Every path returns the SAME neutral message so
// we never confirm whether an address has a Stoop account.

const NEUTRAL_MESSAGE =
  "Check your email — if that address has a Stoop account, a link is on its way.";

const emailSchema = z.email();
const textEncoder = new TextEncoder();

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function clientIp(): Promise<string> {
  const hdrs = await headers();
  return (
    hdrs.get("cf-connecting-ip") ??
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export async function requestMagicLink(rawEmail: string): Promise<{ message: string }> {
  const parsed = emailSchema.safeParse(rawEmail.trim().toLowerCase());
  if (!parsed.success) {
    // Don't reveal validation detail — same neutral response.
    return { message: NEUTRAL_MESSAGE };
  }
  const email = parsed.data;

  const kv = getRateLimitKv();
  if (kv) {
    const [emailHash, ip] = await Promise.all([sha256Hex(email), clientIp()]);
    const [byEmail, byIp] = await Promise.all([
      incrementWithTtl(kv, `magiclink:email:${emailHash}`, 5, 60),
      incrementWithTtl(kv, `magiclink:ip:${ip}`, 20, 3600)
    ]);
    if (!byEmail.allowed || !byIp.allowed) {
      return { message: NEUTRAL_MESSAGE };
    }
  }

  const supabase = await createSupabaseServerClient();
  // Errors are swallowed deliberately: a failed/absent account must look identical to a sent link.
  // shouldCreateUser:false keeps this a pure LOGIN — it never mints an auth.users row for an
  // unknown address (account creation is an explicit signup flow), so the neutral message above
  // stays honest and the endpoint can't be used to bulk-create orphan users.
  await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${requiredEnv("NEXT_PUBLIC_APP_URL")}/auth/callback`
    }
  });

  return { message: NEUTRAL_MESSAGE };
}
