import { describe, expect, it } from "vitest";

import { buildOrderStatusEmail } from "@/lib/email/templates/order-status";

// Phase 6.3: the status-transition email builder. Kit voice — sentence case, second-person, no
// emoji, no error codes — and every status carries the tracking link.

const base = {
  storeName: "Priya's Kitchen",
  trackingUrl: "https://stoop.app/o/tok123",
  footerAddress: "123 Main St, Toronto"
} as const;

const EMOJI = /\p{Extended_Pictographic}/u;

describe("buildOrderStatusEmail", () => {
  it("the ready email is the come-get-it message and carries the tracking link + pickup note", () => {
    const email = buildOrderStatusEmail({
      ...base,
      status: "ready",
      pickupNote: "Lobby / front desk pickup"
    });
    expect(email.subject.toLowerCase()).toContain("ready");
    expect(email.text).toContain("ready for pickup");
    expect(email.text).toContain("https://stoop.app/o/tok123");
    expect(email.html).toContain("https://stoop.app/o/tok123");
    expect(email.text).toContain("Lobby / front desk pickup");
  });

  it("names the store in the subject for each status and never goes off-voice", () => {
    for (const status of [
      "accepted",
      "preparing",
      "ready",
      "complete",
      "cancelled"
    ] as const) {
      const email = buildOrderStatusEmail({ ...base, status });
      expect(email.subject).toContain("Priya's Kitchen");
      expect(email.text).toContain("https://stoop.app/o/tok123");
      // No emoji anywhere in product chrome.
      expect(EMOJI.test(email.subject)).toBe(false);
      expect(EMOJI.test(email.text)).toBe(false);
      expect(EMOJI.test(email.html)).toBe(false);
    }
  });

  it("only the ready email shows a pickup hint", () => {
    const accepted = buildOrderStatusEmail({
      ...base,
      status: "accepted",
      pickupNote: "Lobby / front desk pickup"
    });
    expect(accepted.text).not.toContain("Lobby / front desk pickup");
  });

  it("carries the physical-address footer", () => {
    const email = buildOrderStatusEmail({ ...base, status: "accepted" });
    expect(email.text).toContain("123 Main St, Toronto");
    expect(email.html).toContain("123 Main St, Toronto");
  });
});
