import { describe, expect, it } from "vitest";

import { generateInviteCode, generateToken, isGeneratedToken } from "@/lib/utils/token";

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const INVITE_RE = /^[023456789ABCDEFGHJKMNPQRSTUVWXYZ]+$/;

describe("generateToken", () => {
  it("is 128-bit url-safe base64 with no padding", () => {
    expect(generateToken()).toMatch(TOKEN_RE);
  });

  it("produces zero collisions across 10k generations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      seen.add(generateToken());
    }
    expect(seen.size).toBe(10_000);
  });

  it("recognizes only generated token-shaped strings", () => {
    expect(isGeneratedToken("abcdefghijklmnopqrstuv")).toBe(true);
    expect(isGeneratedToken("abc")).toBe(false);
    expect(isGeneratedToken("abcdefghijklmnopqrstu/")).toBe(false);
    expect(isGeneratedToken("abcdefghijklmnopqrstu=")).toBe(false);
  });
});

describe("generateInviteCode", () => {
  it("defaults to 8 unambiguous characters", () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(8);
    expect(code).toMatch(INVITE_RE);
  });

  it("honors a custom length", () => {
    expect(generateInviteCode(12)).toHaveLength(12);
  });

  it("excludes the ambiguous characters 1, I, L, O", () => {
    for (let i = 0; i < 2_000; i += 1) {
      expect(generateInviteCode()).not.toMatch(/[1ILO]/);
    }
  });
});
