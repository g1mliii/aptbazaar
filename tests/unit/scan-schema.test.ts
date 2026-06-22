import { describe, expect, it } from "vitest";

import {
  SCAN_SRC_FALLBACK,
  scanEventDailyRowSchema,
  scanParamsSchema
} from "@/lib/schemas/scan";

const STORE = "11111111-1111-4111-8111-111111111111";

describe("scanParamsSchema", () => {
  it("accepts a valid store + channel", () => {
    const parsed = scanParamsSchema.parse({ store: STORE, src: "instagram" });
    expect(parsed).toEqual({ store: STORE, src: "instagram" });
  });

  it("defaults a missing channel to direct", () => {
    expect(scanParamsSchema.parse({ store: STORE }).src).toBe(SCAN_SRC_FALLBACK);
  });

  it("lowercases and trims the channel", () => {
    expect(scanParamsSchema.parse({ store: STORE, src: "  Instagram  " }).src).toBe(
      "instagram"
    );
  });

  it("clamps a malformed or over-long channel to direct", () => {
    expect(scanParamsSchema.parse({ store: STORE, src: "bad src!!" }).src).toBe(
      SCAN_SRC_FALLBACK
    );
    expect(scanParamsSchema.parse({ store: STORE, src: "x".repeat(40) }).src).toBe(
      SCAN_SRC_FALLBACK
    );
  });

  it("rejects a non-uuid store", () => {
    expect(scanParamsSchema.safeParse({ store: "nope", src: "direct" }).success).toBe(
      false
    );
  });

  it("accepts the privacy-preserving aggregate row shape", () => {
    expect(
      scanEventDailyRowSchema.parse({
        store_id: STORE,
        src: "poster",
        day: "2026-06-22",
        bucket: 7,
        count: 42
      })
    ).toEqual({
      store_id: STORE,
      src: "poster",
      day: "2026-06-22",
      bucket: 7,
      count: 42
    });
  });
});
