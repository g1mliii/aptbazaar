import { defineConfig, devices } from "@playwright/test";

// Load the gitignored .env.local so both the Playwright runner (which seeds via the service
// role) and the dev server it boots can reach the linked Supabase project. The repo stores
// Supabase config under the integration-test variable names; the app runtime reads the
// NEXT_PUBLIC_* / *_SECRET_KEY names, so bridge them here (only filling what's unset).
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — CI provides the vars through the job environment instead.
}
// Generated env typings narrow these keys to literal strings; assign through a loose view.
const env = process.env as Record<string, string | undefined>;
env.NEXT_PUBLIC_SUPABASE_URL ??= env.SUPABASE_URL;
env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= env.SUPABASE_ANON_KEY;
env.SUPABASE_SECRET_KEY ??= env.SUPABASE_SERVICE_ROLE_KEY;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] }
    }
  ]
});
