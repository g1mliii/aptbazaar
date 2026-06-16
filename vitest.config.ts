import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true
  },
  test: {
    globals: true,
    coverage: {
      reporter: ["text", "lcov"]
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
          setupFiles: ["./vitest.setup.ts"]
        }
      },
      {
        // Integration tests hit a real local Supabase (RLS + tenant isolation). They are
        // NOT part of `npm run verify`; run them with `npm run test:integration`.
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.{test,spec}.ts"],
          setupFiles: ["./tests/integration/setup.ts"],
          testTimeout: 30000,
          hookTimeout: 30000
        }
      }
    ]
  }
});
