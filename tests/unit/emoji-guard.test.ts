import { describe, expect, it } from "vitest";

import { walkSource } from "./source-walk";

// Phase 9.6: the kit's "no emoji in product chrome" rule. Warmth comes from type + color, and
// status uses lucide icons / rubber stamps — never emoji. We scan app/ and lib/ source for emoji
// codepoints. User content (store names, product copy) arrives at runtime through variables, so it
// never appears as a source literal and can't trip this guard.
//
// The arrows block (U+2190–U+21FF, e.g. → ⇒) is deliberately excluded: those are used as plain
// punctuation in code comments and are not emoji. Variation selectors (U+FE0F) only modify a
// preceding emoji that one of the ranges below already catches, so they're left out too.

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

describe("emoji-in-chrome guard", () => {
  const files = [...walkSource("app"), ...walkSource("lib")];

  it("walks a non-trivial number of source files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no emoji in app/ or lib/ source", () => {
    const offenders = files
      .filter((file) => EMOJI.test(file.source))
      .map((file) => {
        const line = file.source.split("\n").findIndex((l) => EMOJI.test(l)) + 1;
        return `${file.path}:${line}`;
      });
    expect(offenders, `emoji found in: ${offenders.join(", ")}`).toEqual([]);
  });
});
