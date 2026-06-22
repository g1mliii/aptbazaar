import { expect, test } from "@playwright/test";

import {
  cleanupUser,
  seedSeller,
  serviceClient,
  type SeededSeller
} from "../integration/helpers/clients";

// Phase 6 regression: the seller advances an order through the status machine and the customer's
// tracking page reflects each state. Status changes are driven through the same
// transition_order_status RPC the dashboard action calls; the tracking page is asserted via a reload
// (the poll/SSE seam is verified separately and is preview-only since the DO may not run under the
// test server). Needs migration 0028 applied and the dev server pointed at the seeded Supabase; if
// seeding fails it skips rather than red-failing CI.

const service = serviceClient();
let seeded: SeededSeller | null = null;
let skipReason = "";

function ciHasSupabaseSeedConfig(): boolean {
  return Boolean(
    process.env.SUPABASE_URL &&
      process.env.SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

test.beforeAll(async () => {
  if (process.env.CI && !ciHasSupabaseSeedConfig()) {
    skipReason =
      "order-lifecycle e2e needs SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in CI.";
    return;
  }
  try {
    seeded = await seedSeller(service, { slug: `e2e-life-${Date.now()}`, isActive: true });
  } catch (err) {
    skipReason = `order-lifecycle e2e needs a seeded Supabase (migration 0028): ${String(err)}`;
  }
});

test.afterAll(async () => {
  if (seeded) await cleanupUser(service, seeded.userId);
});

test("the tracking page reflects each status as the seller advances the order", async ({
  page
}) => {
  test.skip(!seeded, skipReason);
  const shop = seeded!;

  async function advance(to: string) {
    const { error } = await service.rpc("transition_order_status", {
      p_order_id: shop.orderId,
      p_seller_user_id: shop.userId,
      p_to: to as never
    });
    if (error) throw new Error(`transition to ${to}: ${error.message}`);
  }

  await page.goto(`/o/${shop.trackingToken}`);
  await expect(page.getByText("New").first()).toBeVisible();

  for (const [to, label] of [
    ["accepted", "Accepted"],
    ["preparing", "Preparing"],
    ["ready", "Ready"],
    ["complete", "Picked up"]
  ] as const) {
    await advance(to);
    await page.reload();
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
});
