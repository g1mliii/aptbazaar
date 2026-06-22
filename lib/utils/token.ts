// Phase 2.10: cryptographically random tokens. Web Crypto so the same code runs on
// Workers, Node, and the browser. Tokens NEVER encode the underlying row id.

export const GENERATED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Encode bytes as URL-safe base64 with no padding. */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * 128-bit URL-safe token (22 base64url chars). Used for order_tracking_tokens,
 * subscribers.unsubscribe_token, and any other unguessable capability handle.
 */
export function generateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function isGeneratedToken(value: string): boolean {
  return GENERATED_TOKEN_PATTERN.test(value);
}

// 32 unambiguous characters (no 0/O confusion: digit 1 and letters I, L, O removed).
// Length 32 divides 256, so a single random byte maps to a character with no modulo bias.
const INVITE_ALPHABET = "023456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Human-typeable building invite code (default 8 chars), printed on a building's QR poster. */
export function generateInviteCode(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
  }
  return code;
}
