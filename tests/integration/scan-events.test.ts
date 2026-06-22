import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  authedClient,
  cleanupUser,
  seedSeller,
  serviceClient,
  type Db,
  type SeededSeller
} from "./helpers/clients";

// Phase 7.4 regression: the record_scan() RPC (privacy-preserving aggregate + first_scan_at stamp)
// and the owner-only RLS on scan_event_daily. Requires migration 0034 applied to the target
// project. The table must never carry PII — only store_id / src / day / bucket / count.

const service = serviceClient();

let sellerA: SeededSeller;
let sellerB: SeededSeller;

async function recordScan(storeId: string, src: string): Promise<void> {
  const { error } = await service.rpc("record_scan", {
    p_store_id: storeId,
    p_src: src
  });
  expect(error).toBeNull();
}

beforeAll(async () => {
  sellerA = await seedSeller(service, { slug: `scanA-${Date.now()}` });
  sellerB = await seedSeller(service, { slug: `scanB-${Date.now()}` });
});

afterAll(async () => {
  await cleanupUser(service, sellerA.userId);
  await cleanupUser(service, sellerB.userId);
});

describe("record_scan", () => {
  it("aggregates per-channel counts and stores no PII", async () => {
    await recordScan(sellerA.storeId, "instagram");
    await recordScan(sellerA.storeId, "instagram");
    await recordScan(sellerA.storeId, "direct");

    const { data: rows } = await service
      .from("scan_event_daily")
      .select("*")
      .eq("store_id", sellerA.storeId);

    const instagramCount = (rows ?? [])
      .filter((row) => row.src === "instagram")
      .reduce((sum, row) => sum + row.count, 0);
    expect(instagramCount).toBe(2);

    // The entire row shape — assert there are no extra (PII) columns.
    expect(Object.keys(rows![0]!).sort()).toEqual([
      "bucket",
      "count",
      "day",
      "src",
      "store_id"
    ]);
  });

  it("returns owner-ready channel totals from SQL", async () => {
    await recordScan(sellerA.storeId, "instagram");
    await recordScan(sellerA.storeId, "instagram");

    const { data: summary, error } = await service.rpc("get_store_scan_summary", {
      p_store_id: sellerA.storeId
    });
    expect(error).toBeNull();

    const instagram = (summary ?? []).find((row) => row.src === "instagram");
    expect(instagram?.count).toBeGreaterThanOrEqual(2);
  });

  it("stamps first_scan_at exactly once", async () => {
    const { data: first } = await service
      .from("stores")
      .select("first_scan_at")
      .eq("id", sellerA.storeId)
      .single();
    expect(first?.first_scan_at).not.toBeNull();

    await recordScan(sellerA.storeId, "whatsapp");

    const { data: second } = await service
      .from("stores")
      .select("first_scan_at")
      .eq("id", sellerA.storeId)
      .single();
    expect(second?.first_scan_at).toBe(first?.first_scan_at);
  });
});

describe("scan_event_daily RLS", () => {
  it("lets an owner read their own scans but hides another tenant's", async () => {
    await recordScan(sellerA.storeId, "poster");

    const clientA: Db = await authedClient(sellerA.email, sellerA.password);
    const { data: own } = await clientA
      .from("scan_event_daily")
      .select("src, count")
      .eq("store_id", sellerA.storeId);
    expect((own ?? []).length).toBeGreaterThan(0);

    const clientB: Db = await authedClient(sellerB.email, sellerB.password);
    const { data: foreign } = await clientB
      .from("scan_event_daily")
      .select("*")
      .eq("store_id", sellerA.storeId);
    expect(foreign ?? []).toHaveLength(0);
  });
});
