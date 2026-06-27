// Phase 9.3: per-minute fixed-window keys + limits for the anon order and subscribe flows. The
// minute bucket lives in the KV key (same shape as the per-day drop window), so each wall-clock
// minute gets a fresh counter and the window length passed to addToWindows is a flat 60s. Two-tier:
// a per-(ip, store) cap stops one client hammering a store, and a per-store cap catches a single
// store being flooded across many IPs.
//
// The per-(ip, store) cap must leave headroom for a shared NAT, but the checked-in Phase 9 plan
// pins the public-order threshold at 10/min and the per-store flood ceiling at 30/min.

export const ANON_WINDOW_SECONDS = 60;

export const ORDER_IP_STORE_LIMIT = 10;
export const ORDER_STORE_LIMIT = 30;
export const SUBSCRIBE_IP_STORE_LIMIT = 5;
export const SUBSCRIBE_STORE_LIMIT = 60;
// Seller-authenticated, not anon, but the same per-minute window shape (Phase 9.3 image upload cap).
export const UPLOAD_SELLER_LIMIT = 30;

function minuteBucket(now: number): number {
  return Math.floor(now / (ANON_WINDOW_SECONDS * 1000));
}

export function orderIpStoreKey(ip: string, storeId: string, now: number): string {
  return `order:ipstore:${ip}:${storeId}:${minuteBucket(now)}`;
}

export function orderStoreKey(storeId: string, now: number): string {
  return `order:store:${storeId}:${minuteBucket(now)}`;
}

export function subscribeIpStoreKey(ip: string, storeId: string, now: number): string {
  return `sub:ipstore:${ip}:${storeId}:${minuteBucket(now)}`;
}

export function subscribeStoreKey(storeId: string, now: number): string {
  return `sub:store:${storeId}:${minuteBucket(now)}`;
}

export function uploadSellerKey(userId: string, now: number): string {
  return `upload:seller:${userId}:${minuteBucket(now)}`;
}
