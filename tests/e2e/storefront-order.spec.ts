import { expect, test } from "@playwright/test";

import {
  cleanupUser,
  seedSeller,
  serviceClient,
  type SeededSeller
} from "../integration/helpers/clients";

// Phase 4 regression: the full no-payment customer flow — storefront → cart → checkout →
// placement → tracking page. Needs migration 0020 applied and the dev server pointed at the same
// Supabase the seed writes to. If seeding fails (migration not applied / no DB), the suite skips
// rather than red-failing CI before the backend is provisioned.

const service = serviceClient();
let seeded: SeededSeller | null = null;
let skipReason = "";

test.beforeAll(async () => {
  try {
    seeded = await seedSeller(service, { slug: `e2e-shop-${Date.now()}`, isActive: true });
  } catch (err) {
    skipReason = `storefront e2e needs a seeded Supabase (migration 0020): ${String(err)}`;
  }
});

test.afterAll(async () => {
  if (seeded) await cleanupUser(service, seeded.userId);
});

test("customer can browse, order, and reach the tracking page", async ({ page }) => {
  test.skip(!seeded, skipReason);
  const shop = seeded!;

  await page.goto(`/s/${shop.slug}`);
  await expect(page.getByRole("heading", { name: /Store /i })).toBeVisible();

  // Add the seeded product (seedSeller creates "Sourdough"), then open the cart.
  await page.getByRole("button", { name: /Add Sourdough to cart/i }).click();
  await page.getByRole("button", { name: /View cart/i }).click();

  await page.getByRole("button", { name: /Checkout —/i }).click();

  // Fill checkout and place the order (pay-at-pickup — no Stripe in Phase 4). Scope to the
  // checkout dialog so the field labels don't collide with the subscribe form on the page.
  const checkout = page.getByRole("dialog", { name: "Checkout" });
  await checkout.getByLabel("Your name").fill("Sam Customer");
  await checkout.getByLabel("Email").fill("sam-e2e@example.test");
  await checkout.getByRole("button", { name: "Place order" }).click();

  // Lands on the tokenized tracking page, no login.
  await expect(page).toHaveURL(/\/o\/[A-Za-z0-9_-]{16,}/);
  await expect(
    page.getByRole("heading", { name: "Your order is in." })
  ).toBeVisible();
});

test("unknown storefront shows the neighbor-tone not-found copy", async ({ page }) => {
  await page.goto("/s/this-slug-does-not-exist-xyz");
  await expect(
    page.getByText("This stoop hasn't been set up yet.")
  ).toBeVisible();
});
