import { afterEach, describe, expect, it, vi } from "vitest";

import { sendEmail } from "@/lib/email/send-email";

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

function mockCloudflareContext(context: TestCloudflareContext) {
  cloudflareMocks.getCloudflareContext.mockReturnValue(context);
}

describe("Cloudflare email", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("sends mail through the Cloudflare Email binding", async () => {
    vi.stubEnv("CLOUDFLARE_EMAIL_FROM", "orders@stoop.example");
    vi.stubEnv("CLOUDFLARE_EMAIL_FROM_NAME", "Stoop");

    const send = vi.fn().mockResolvedValue({ messageId: "test-message" });
    mockCloudflareContext({
      cf: undefined,
      ctx: {},
      env: {
        EMAIL: { send }
      }
    });

    await sendEmail({
      to: "buyer@example.com",
      subject: "Your order's in",
      html: "<p>Your order is in.</p>",
      text: "Your order is in."
    });

    expect(send).toHaveBeenCalledWith({
      from: {
        email: "orders@stoop.example",
        name: "Stoop"
      },
      html: "<p>Your order is in.</p>",
      subject: "Your order's in",
      text: "Your order is in.",
      to: "buyer@example.com"
    });
  });

  it("fails loudly when the Cloudflare Email binding is missing", async () => {
    vi.stubEnv("CLOUDFLARE_EMAIL_FROM", "orders@stoop.example");
    mockCloudflareContext({
      cf: undefined,
      ctx: {},
      env: {}
    });

    await expect(
      sendEmail({
        to: "buyer@example.com",
        subject: "Your order's in",
        html: "<p>Your order is in.</p>",
        text: "Your order is in."
      })
    ).rejects.toThrow("Cloudflare Email binding EMAIL is required");
  });
});
