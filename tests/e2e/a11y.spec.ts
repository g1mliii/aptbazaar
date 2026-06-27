import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Phase 9.6: automated accessibility gate. We scan the public, no-auth surfaces (landing, signup,
// login) which exercise the shared design-system primitives — Button, Input, Checkbox, the radio
// group, focus rings, and color/contrast token pairings. Storefront, dashboard, and bazaar reuse
// the same primitives; their authenticated/seeded scans run in the integration harness.
//
// The bar is zero serious/critical violations (WCAG 2.0/2.1 A + AA).

const PUBLIC_ROUTES = ["/", "/signup", "/login"];

for (const route of PUBLIC_ROUTES) {
  test(`no serious or critical a11y violations on ${route}`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );

    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help}`).join("\n")
    ).toEqual([]);
  });
}
