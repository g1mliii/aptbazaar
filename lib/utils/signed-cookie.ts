import { requiredEnv } from "@/lib/env";

// Shared HMAC envelope for our signed cookies (quick-start signup + bazaar invite). A cookie value is
// `<base64url(payload JSON)>.<base64url(HMAC-SHA256(body))>`. Built on Web Crypto so the same code
// runs in the edge middleware and the Workers runtime — do NOT add `server-only` here. This module
// only proves we signed the bytes; payload shape, TTL, and scope checks live in each caller.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(requiredEnv("SIGNUP_COOKIE_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** Constant-time comparison so a forged signature can't be probed byte-by-byte. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/** Constant-time string compare (no early exit on first mismatch). */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  return timingSafeEqual(encoder.encode(a), encoder.encode(b));
}

/** Sign a JSON-serializable payload into a `<body>.<sig>` cookie value. */
export async function signCookiePayload(payload: unknown): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey();
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(body))
  );
  return `${body}.${base64UrlEncode(sig)}`;
}

/**
 * Verify a `<body>.<sig>` cookie value and return its decoded JSON payload, or null when the value is
 * missing, malformed, or the signature doesn't match. Callers validate the payload's shape and TTL.
 */
export async function readCookiePayload(
  raw: string | undefined
): Promise<unknown> {
  if (!raw) {
    return null;
  }
  const dot = raw.indexOf(".");
  if (dot <= 0) {
    return null;
  }
  const body = raw.slice(0, dot);
  const providedSig = raw.slice(dot + 1);

  try {
    const key = await hmacKey();
    const expectedSig = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(body))
    );
    if (!timingSafeEqual(expectedSig, base64UrlDecode(providedSig))) {
      return null;
    }
    return JSON.parse(decoder.decode(base64UrlDecode(body)));
  } catch {
    return null;
  }
}
