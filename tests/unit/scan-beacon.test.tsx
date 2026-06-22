import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScanBeacon } from "@/app/s/[slug]/scan-beacon";

const STORE_ID = "11111111-1111-4111-8111-111111111111";

let requested: string[];

class MockImage {
  set src(value: string) {
    requested.push(value);
  }
}

beforeEach(() => {
  requested = [];
  vi.stubGlobal("Image", MockImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("ScanBeacon", () => {
  it("fires a scan pixel with the channel tag", () => {
    window.history.replaceState(null, "", "/s/maple-bakery?src=instagram");

    render(<ScanBeacon storeId={STORE_ID} />);

    expect(requested).toEqual([`/api/scan?store=${STORE_ID}&src=instagram`]);
  });

  it("skips dashboard preview links without a server ownership check", () => {
    window.history.replaceState(null, "", "/s/maple-bakery?preview=1");

    render(<ScanBeacon storeId={STORE_ID} />);

    expect(requested).toEqual([]);
  });
});
