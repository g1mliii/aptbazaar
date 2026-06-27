import { defineConfig } from "vitest/config";

// Local config so vitest doesn't walk up to the app's root config (which scopes includes to the
// app's tests/). The image-processor's only tests are the container sanitizer fixtures (Phase 9.4).
export default defineConfig({
  test: {
    environment: "node",
    include: ["container/**/*.test.mjs"]
  }
});
