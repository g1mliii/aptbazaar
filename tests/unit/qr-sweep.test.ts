import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sweepQrAssets } from "@/worker/qr-sweep";

const SERVICE_KEY = "service-key";
const SUPABASE_URL = "https://stoop.supabase.co";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("store-live")) {
        return Promise.resolve(
          Response.json([
            {
              id: "store-live",
              slug: "maple-bakery",
              visibility: "qr_only",
              name: "Maple Bakery",
              description: "Saturday loaves"
            }
          ])
        );
      }
      return Promise.resolve(Response.json([]));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sweepQrAssets", () => {
  it("processes R2 pages independently and deletes only stale objects", async () => {
    const bucket = {
      list: vi
        .fn()
        .mockResolvedValueOnce({
          truncated: true,
          cursor: "next",
          objects: [
            {
              key: "qr/store-live/current.svg",
              customMetadata: {
                slug: "maple-bakery",
                visibility: "qr_only",
                name: "Maple Bakery",
                description: "Saturday loaves"
              }
            },
            {
              key: "qr/store-live/old.svg",
              customMetadata: {
                slug: "old-maple",
                visibility: "qr_only",
                name: "Maple Bakery",
                description: "Saturday loaves"
              }
            },
            {
              key: "qr/buildings/building-live/current.pdf",
              customMetadata: {
                scope: "building",
                slug: "bazaar-abc123",
                accessType: "open",
                name: "Building bazaar"
              }
            }
          ]
        })
        .mockResolvedValueOnce({
          truncated: false,
          objects: [
            {
              key: "qr/store-gone/old.svg",
              customMetadata: {
                slug: "gone",
                visibility: "qr_only",
                name: "Gone",
                description: ""
              }
            }
          ]
        }),
      delete: vi.fn()
    };

    await expect(
      sweepQrAssets({
        QR_BUCKET: bucket as unknown as R2Bucket,
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
        SUPABASE_SECRET_KEY: SERVICE_KEY
      })
    ).resolves.toEqual({ scanned: 4, deleted: 2 });

    expect(bucket.list).toHaveBeenNthCalledWith(1, {
      prefix: "qr/",
      cursor: undefined,
      include: ["customMetadata"]
    });
    expect(bucket.list).toHaveBeenNthCalledWith(2, {
      prefix: "qr/",
      cursor: "next",
      include: ["customMetadata"]
    });
    expect(bucket.delete).toHaveBeenNthCalledWith(1, ["qr/store-live/old.svg"]);
    expect(bucket.delete).toHaveBeenNthCalledWith(2, ["qr/store-gone/old.svg"]);
  });
});
