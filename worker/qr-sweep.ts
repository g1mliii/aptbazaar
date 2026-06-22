// Phase 7.6: the weekly orphan sweep for cached QR assets. Self-contained (no `@/` imports) so it
// bundles cleanly alongside the OpenNext worker through worker.mjs, and talks to Supabase over REST
// rather than dragging supabase-js into the worker bundle. Every cached object carries its store's
// slug + visibility + name + description in customMetadata at write time (see app/api/qr/route.ts),
// so the sweep compares metadata against the live row and never has to recompute the content hash.
// An object is reclaimed when its store is gone or when any of those fields no longer matches (a
// change re-keys the live asset and orphans the old one). The fonts/ prefix is untouched — we only
// ever list qr/.

interface SweepEnv {
  QR_BUCKET?: R2Bucket;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

interface StoreRow {
  slug: string;
  visibility: string;
  name: string;
  description: string | null;
}

function storeIdFromKey(key: string): string | null {
  // qr/<store_id>/<sha>.<ext>
  const parts = key.split("/");
  return parts.length >= 3 && parts[0] === "qr" ? (parts[1] ?? null) : null;
}

async function fetchStores(
  supabaseUrl: string,
  serviceKey: string,
  ids: string[]
): Promise<Map<string, StoreRow>> {
  const stores = new Map<string, StoreRow>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids
      .slice(i, i + 100)
      .map(encodeURIComponent)
      .join(",");
    const res = await fetch(
      `${supabaseUrl}/rest/v1/stores?id=in.(${chunk})&select=id,slug,visibility,name,description`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    // A transient REST failure must NOT be read as "these stores are gone" — that would wipe every
    // cached asset for the chunk. Throw so the caller aborts this run without deleting anything.
    if (!res.ok) {
      throw new Error(`stores fetch failed: ${res.status}`);
    }
    const rows: Array<StoreRow & { id: string }> = await res.json();
    for (const row of rows) {
      stores.set(row.id, {
        slug: row.slug,
        visibility: row.visibility,
        name: row.name,
        description: row.description
      });
    }
  }
  return stores;
}

export async function sweepQrAssets(
  env: SweepEnv
): Promise<{ scanned: number; deleted: number }> {
  const bucket = env.QR_BUCKET;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SECRET_KEY;
  if (!bucket || !supabaseUrl || !serviceKey) {
    return { scanned: 0, deleted: 0 };
  }

  let scanned = 0;
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix: "qr/",
      cursor,
      include: ["customMetadata"]
    });
    const objects = page.objects.map((object) => ({
      key: object.key,
      meta: object.customMetadata ?? {},
      storeId: storeIdFromKey(object.key)
    }));
    scanned += objects.length;

    if (objects.length > 0) {
      const storeIds = new Set<string>();
      for (const object of objects) {
        if (object.storeId) storeIds.add(object.storeId);
      }

      let stores: Map<string, StoreRow>;
      try {
        stores = await fetchStores(supabaseUrl, serviceKey, [...storeIds]);
      } catch {
        // Couldn't resolve the live store rows this run — skip deletion entirely rather than risk
        // reclaiming assets for stores that are merely unreachable. The cache is regenerable; a
        // missed sweep just defers cleanup to next week.
        return { scanned, deleted };
      }

      const toDelete: string[] = [];
      for (const object of objects) {
        const store = object.storeId ? stores.get(object.storeId) : undefined;
        if (
          !store ||
          object.meta.slug !== store.slug ||
          object.meta.visibility !== store.visibility ||
          object.meta.name !== store.name ||
          object.meta.description !== (store.description ?? "")
        ) {
          toDelete.push(object.key);
        }
      }

      for (let i = 0; i < toDelete.length; i += 1000) {
        await bucket.delete(toDelete.slice(i, i + 1000));
      }
      deleted += toDelete.length;
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return { scanned, deleted };
}
