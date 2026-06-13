import { expect, test } from "@playwright/test";

test("landing page and health route are reachable", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Set up your stoop/i })).toBeVisible();
  await expect(page.getByText("Phase 1 foundation")).toBeVisible();

  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  const payload = (await health.json()) as { status: string };
  expect(payload.status).toBe("ok");
});
