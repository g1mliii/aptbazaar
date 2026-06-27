"use server";

import { z } from "zod";

import { requiredEnv } from "@/lib/env";
import { getRateLimitKv, incrementWithTtl } from "@/lib/ratelimit/kv";
import { clientIp } from "@/lib/security/request-ip";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Phase 2.7: magic-link issuance, rate-limited in our own server action because the
// Supabase OTP endpoint lives on Supabase's domain (Cloudflare can't see that traffic).
// Limits: 5/min per email, 20/hour per IP. Every path returns the SAME neutral message so
// we never confirm whether an address has a Stoop account.

const NEUTRAL_MESSAGE =
  "Check your email — if that address has a Stoop account, a link is on its way.";
// Signup can be honest that a link is coming (the caller already validated the form), but we
// keep the same don't-confirm-the-address shape so an existing-account guess looks identical.
const SIGNUP_MESSAGE =
  "Check your email — open the link to finish setting up your stoop.";

const emailSchema = z.email();
const textEncoder = new TextEncoder();

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function rateLimitOk(email: string): Promise<boolean> {
  const kv = getRateLimitKv();
  if (!kv) {
    return true;
  }
  const [emailHash, ip] = await Promise.all([sha256Hex(email), clientIp()]);
  const [byEmail, byIp] = await Promise.all([
    incrementWithTtl(kv, `magiclink:email:${emailHash}`, 5, 60),
    incrementWithTtl(kv, `magiclink:ip:${ip}`, 20, 3600)
  ]);
  return byEmail.allowed && byIp.allowed;
}

export async function requestMagicLink(rawEmail: string): Promise<{ message: string }> {
  const parsed = emailSchema.safeParse(rawEmail.trim().toLowerCase());
  if (!parsed.success) {
    // Don't reveal validation detail — same neutral response.
    return { message: NEUTRAL_MESSAGE };
  }
  const email = parsed.data;

  if (!(await rateLimitOk(email))) {
    return { message: NEUTRAL_MESSAGE };
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

/**
 * Phase 3.1: signup-specific magic link. shouldCreateUser:true mints the auth.users row for a
 * brand-new seller; the callback (lib/actions/signup wiring) reads the signed quick-start
 * cookie and atomically creates the tenant. Same rate limit as login.
 */
export async function requestSignupMagicLink(
  rawEmail: string
): Promise<{ message: string }> {
  // Normalize the same way as login so the rate-limit key and the OTP recipient don't vary by
  // case/whitespace (case-variant addresses would otherwise each get their own send budget).
  const parsed = emailSchema.safeParse(rawEmail.trim().toLowerCase());
  if (!parsed.success) {
    return { message: SIGNUP_MESSAGE };
  }
  const email = parsed.data;

  if (!(await rateLimitOk(email))) {
    return { message: SIGNUP_MESSAGE };
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${requiredEnv("NEXT_PUBLIC_APP_URL")}/auth/callback`
    }
  });

  return { message: SIGNUP_MESSAGE };
}
