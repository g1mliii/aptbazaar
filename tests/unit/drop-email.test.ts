import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDropEmail } from "@/lib/email/templates/drop";

// Phase 6.5: the seller's drop email. Anti-spam law requires the sender's identity + physical
// address + a working unsubscribe in every commercial broadcast; the RFC 8058 headers drive the
// native one-click button in Gmail/Apple Mail.

type TestCloudflareContext = {
  cf: undefined;
  ctx: object;
  env: Record<string, unknown>;
};

const cloudflareMocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn<() => TestCloudflareContext>()
}));

vi.mock("server-only", () => ({}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: cloudflareMocks.getCloudflareContext
}));

const base = {
  storeName: "Priya's Kitchen",
  sellerDisplayName: "Priya M.",
  contactAddress: "123 Main St, Toronto",
  subject: "Saturday bake list is up",
  bodyText: "Sourdough and cardamom buns.\nPickup Saturday 9–1.",
  unsubscribeUrl: "https://stoop.app/u/tok123"
} as const;

const EMOJI = /\p{Extended_Pictographic}/u;

describe("buildDropEmail", () => {
  it("carries the seller identity + address footer and the unsubscribe link", () => {
    const email = buildDropEmail(base);
    expect(email.subject).toBe("Saturday bake list is up");
    expect(email.text).toContain("Priya M.");
    expect(email.text).toContain("123 Main St, Toronto");
    expect(email.html).toContain("Priya M.");
    expect(email.html).toContain("123 Main St, Toronto");
    expect(email.text).toContain("https://stoop.app/u/tok123");
    expect(email.html).toContain("https://stoop.app/u/tok123");
    expect(email.html).toContain("Unsubscribe from Priya's Kitchen");
  });

  it("preserves the seller's line breaks in the body", () => {
    const email = buildDropEmail(base);
    expect(email.text).toContain("Sourdough and cardamom buns.");
    expect(email.html).toContain("Pickup Saturday 9–1.");
    expect(email.html).toContain("<br/>");
  });

  it("escapes HTML in seller-authored content (no raw injection)", () => {
    const email = buildDropEmail({
      ...base,
      subject: "Hi <script>",
      bodyText: "Order here: <b>now</b> & save",
      sellerDisplayName: "Priya <script>"
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&lt;b&gt;now&lt;/b&gt;");
    expect(email.html).toContain("&amp; save");
    expect(EMOJI.test(email.html)).toBe(false);
  });
});

describe("sendDropEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("sets the RFC 8058 List-Unsubscribe + one-click headers", async () => {
    vi.stubEnv("CLOUDFLARE_EMAIL_FROM", "drops@stoop.example");
    type SentPayload = { headers: Record<string, string>; to: string };
    const send = vi.fn<(payload: SentPayload) => Promise<unknown>>().mockResolvedValue({
      messageId: "m1"
    });
    cloudflareMocks.getCloudflareContext.mockReturnValue({
      cf: undefined,
      ctx: {},
      env: { EMAIL: { send } }
    });

    const { sendDropEmail } = await import("@/lib/email/drop");
    await sendDropEmail({
      to: "fan@example.com",
      storeName: base.storeName,
      sellerDisplayName: base.sellerDisplayName,
      contactAddress: base.contactAddress,
      subject: base.subject,
      bodyText: base.bodyText,
      unsubscribeUrl: "https://stoop.app/u/tok123",
      oneClickUrl: "https://stoop.app/api/unsubscribe/tok123"
    });

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]![0];
    expect(payload.headers["List-Unsubscribe"]).toContain(
      "<https://stoop.app/api/unsubscribe/tok123>"
    );
    expect(payload.headers["List-Unsubscribe"]).toContain(
      "<mailto:drops@stoop.example?subject=unsubscribe>"
    );
    expect(payload.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(payload.to).toBe("fan@example.com");
  });
});
