import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const componentFiles = [
  "app/components/ui/button.tsx",
  "app/components/ui/card.tsx",
  "app/components/ui/form.tsx",
  "app/components/ui/stamp.tsx",
  "app/components/ui/seal.tsx",
  "app/components/ui/toast.tsx",
  "app/components/ui/empty-state.tsx",
  "app/components/ui/receipt.tsx",
  "app/components/ui/dialog.tsx",
  "app/components/ui/drawer.tsx",
  "app/components/ui/sheet.tsx",
  "app/components/brand/logo.tsx"
];

describe("design guard", () => {
  it("keeps component code free of raw hex colors", () => {
    const rawHex = /#[0-9a-fA-F]{3,8}/;

    for (const file of componentFiles) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(rawHex);
    }
  });

  it("does not import runtime code from the ignored design kit", () => {
    for (const file of componentFiles) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, file).not.toContain("aptbazaar Design System");
    }
  });

  it("keeps primitive focus and motion classes guideline-compliant", () => {
    for (const file of componentFiles) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, file).not.toContain("outline-none");
      expect(source, file).not.toContain("transition-all");
    }
  });
});
