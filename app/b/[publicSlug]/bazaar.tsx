"use client";

import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";

import { Logo } from "@/app/components/brand/logo";
import { formatMoney } from "@/lib/pricing/currency";
import { cn } from "@/lib/utils/cn";

// Phase 8.2 bazaar client. Mirrors aptbazaar Design System/ui_kits/bazaar/*.jsx — verdigris awning
// header, teal active category chips, marigold "fresh" drop stamps, serif seller names, mono counts.
// No unit numbers anywhere (the data never carries them), no emoji in chrome.

export interface BazaarSeller {
  slug: string;
  name: string;
  category: string | null;
  logoUrl: string | null;
  topProduct: string | null;
  ordersThisWeek: number;
}

export interface BazaarDrop {
  id: string;
  product: string;
  priceCents: number;
  imageUrl: string | null;
  shopName: string;
  shopSlug: string;
  left: number | null;
}

interface BazaarBuilding {
  name: string;
  city: string | null;
  slug: string;
}

const ALL = "all";

// Brand-color tiles for shops/drops without a photo — the same typographic-poster identity as the
// storefront product tiles (app/components/storefront/product-card.tsx).
const TILES = [
  { bg: "bg-verdigris", fg: "text-surface" },
  { bg: "bg-mulberry", fg: "text-surface" },
  { bg: "bg-teal", fg: "text-surface" },
  { bg: "bg-marigold", fg: "text-ink" },
  { bg: "bg-ink", fg: "text-surface" }
] as const;

function tileFor(seed: string): (typeof TILES)[number] {
  let hash = 0;
  for (const ch of seed) hash = (hash + ch.charCodeAt(0)) % TILES.length;
  return TILES[hash] ?? TILES[0];
}

export function BazaarPage({
  building,
  sellers,
  drops
}: {
  building: BazaarBuilding;
  sellers: BazaarSeller[];
  drops: BazaarDrop[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const seller of sellers) {
      const key = seller.category?.trim();
      if (key) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [
      { id: ALL, label: "All", count: sellers.length },
      ...Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => ({ id: label, label, count }))
    ];
  }, [sellers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sellers.filter((seller) => {
      const matchesCategory = category === ALL || seller.category === category;
      const matchesQuery =
        !q ||
        `${seller.name} ${seller.topProduct ?? ""} ${seller.category ?? ""}`
          .toLowerCase()
          .includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [sellers, query, category]);

  const showDrops = !query && category === ALL && drops.length > 0;

  return (
    <main className="mx-auto w-full max-w-md pb-12">
      <BuildingHeader
        name={building.name}
        city={building.city}
        sellerCount={sellers.length}
        dropCount={drops.length}
      />

      <div className="px-4">
        <div className="mt-4 flex items-center gap-2 rounded-md border border-line bg-surface px-3.5 py-2.5 shadow-sm transition-[border-color,box-shadow] duration-fast ease-stoop focus-within:border-verdigris focus-within:shadow-[0_0_0_var(--ab-s-1)_var(--ab-verdigris-3)]">
          <Search
            aria-hidden="true"
            className="h-4 w-4 shrink-0 stroke-[1.6] text-ink-3"
          />
          <input
            className="w-full border-none bg-transparent font-sans text-14 text-ink outline-none placeholder:text-ink-3"
            placeholder={`Search ${sellers.length} ${sellers.length === 1 ? "shop" : "shops"}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search shops"
          />
        </div>

        <div className="mt-3.5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {categories.map((c) => {
            const active = c.id === category;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                aria-pressed={active}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-3.5 py-1.5 font-sans text-13 font-semibold transition-[background-color,border-color,color,transform] duration-fast ease-stoop focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris active:translate-y-px",
                  active
                    ? "border-teal bg-teal text-surface"
                    : "border-line bg-surface text-ink-2 hover:bg-paper-2"
                )}
              >
                {c.label}
                <span className="font-mono text-12 tabular-nums opacity-75">
                  {c.count}
                </span>
              </button>
            );
          })}
        </div>

        {showDrops ? <DropsRow drops={drops} /> : null}

        <div className="mt-5 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-24 leading-none text-ink">
            {category === ALL ? "All shops" : category}
          </h2>
          <span className="font-mono text-12 uppercase tracking-[0.06em] text-ink-3">
            {filtered.length} {filtered.length === 1 ? "shop" : "shops"}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="px-2 py-10 text-center">
            <p className="font-display text-20 text-ink">Nothing matches yet.</p>
            <p className="mt-1.5 text-13 text-ink-2">
              Try clearing the search, or ping a neighbor — maybe they should open a
              stoop.
            </p>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {filtered.map((seller) => (
              <SellerCard key={seller.slug} seller={seller} />
            ))}
          </div>
        )}

        <BazaarFooter buildingName={building.name} />
      </div>
    </main>
  );
}

function BuildingHeader({
  name,
  city,
  sellerCount,
  dropCount
}: {
  name: string;
  city: string | null;
  sellerCount: number;
  dropCount: number;
}) {
  return (
    <div className="bg-verdigris px-5 pb-7 pt-5 text-surface shadow-stamp">
      <p className="font-mono text-12 uppercase tracking-[0.16em] text-surface/70">
        Local bazaar{city ? ` · ${city}` : ""}
      </p>
      <h1 className="mt-1 font-display text-36 leading-none">{name}</h1>
      <p className="mt-1.5 font-sans text-13 text-surface/85">
        {sellerCount} {sellerCount === 1 ? "neighbor" : "neighbors"} selling — pickup
        only, no DMs.
      </p>
      <div className="mt-3.5 flex flex-wrap gap-2">
        <Pill>
          <b className="font-mono font-medium tabular-nums">{sellerCount}</b>{" "}
          {sellerCount === 1 ? "shop" : "shops"}
        </Pill>
        {dropCount > 0 ? (
          <Pill>
            <b className="font-mono font-medium tabular-nums">{dropCount}</b> fresh
            today
          </Pill>
        ) : null}
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-surface/20 bg-surface/15 px-2.5 py-1 font-sans text-12 font-semibold text-surface">
      {children}
    </span>
  );
}

function DropsRow({ drops }: { drops: BazaarDrop[] }) {
  const shopCount = new Set(drops.map((d) => d.shopName)).size;
  return (
    <>
      <div className="mt-5 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-24 leading-none text-ink">
          Today&apos;s drops
        </h2>
        <span className="font-mono text-12 uppercase tracking-[0.06em] text-ink-3">
          fresh from {shopCount} {shopCount === 1 ? "shop" : "shops"}
        </span>
      </div>
      <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        {drops.map((drop) => (
          <Link
            key={drop.id}
            href={`/s/${drop.shopSlug}`}
            className="flex w-[220px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-sm transition-[box-shadow,transform] duration-fast ease-stoop hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris active:translate-y-px"
          >
            <div
              className={cn(
                "relative flex aspect-[16/10] items-center justify-center",
                drop.imageUrl ? "bg-paper-2" : tileFor(drop.id).bg
              )}
            >
              <span className="absolute left-2 top-2 z-10 -rotate-3 rounded-xs bg-marigold px-1.5 py-0.5 font-sans text-12 font-bold uppercase tracking-[0.04em] text-ink shadow-stamp">
                Fresh
              </span>
              {drop.imageUrl ? (
                <Image
                  src={drop.imageUrl}
                  alt={drop.product}
                  fill
                  sizes="220px"
                  className="object-cover"
                />
              ) : (
                <span
                  className={cn(
                    "font-display text-48 leading-none",
                    tileFor(drop.id).fg
                  )}
                >
                  {drop.product.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
              <p className="break-words font-sans text-13 font-semibold leading-tight text-ink">
                {drop.product}
              </p>
              <p className="break-words text-12 text-ink-3">
                {drop.shopName}
                {drop.left !== null ? ` · ${drop.left} left` : ""}
              </p>
              <span className="mt-1 font-mono text-14 font-medium tabular-nums text-ink">
                {formatMoney(drop.priceCents)}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

function SellerCard({ seller }: { seller: BazaarSeller }) {
  return (
    <Link
      href={`/s/${seller.slug}`}
      className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-sm transition-[box-shadow,transform] duration-fast ease-stoop hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris active:translate-y-px"
    >
      <div
        className={cn(
          "relative flex aspect-square items-center justify-center",
          seller.logoUrl ? "bg-paper-2" : tileFor(seller.slug).bg
        )}
      >
        {seller.logoUrl ? (
          <Image
            src={seller.logoUrl}
            alt={seller.name}
            fill
            sizes="180px"
            className="object-cover"
          />
        ) : (
          <span
            className={cn("font-display text-64 leading-none", tileFor(seller.slug).fg)}
          >
            {seller.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="relative flex min-w-0 flex-1 flex-col p-3">
        <p className="break-words font-sans text-14 font-semibold leading-tight text-ink">
          {seller.name}
        </p>
        {seller.category ? (
          <p className="mt-0.5 break-words font-mono text-12 uppercase tracking-[0.06em] text-ink-3">
            {seller.category}
          </p>
        ) : null}
        {seller.topProduct ? (
          <p className="mt-1.5 break-words text-12 leading-snug text-ink-2">
            {seller.topProduct}
          </p>
        ) : null}
        <div className="mt-2 flex items-center justify-between">
          <span className="font-mono text-12 tabular-nums text-ink-3">
            {seller.ordersThisWeek} orders this wk
          </span>
          <ChevronRight
            aria-hidden="true"
            className="h-4 w-4 stroke-[1.5] text-ink-2"
          />
        </div>
      </div>
    </Link>
  );
}

function BazaarFooter({ buildingName }: { buildingName: string }) {
  return (
    <>
      <div className="mt-6 overflow-hidden rounded-xl bg-ink p-5 text-surface">
        <p className="font-mono text-12 uppercase tracking-[0.16em] text-surface/60">
          Live here?
        </p>
        <p className="mt-1.5 font-display text-24 leading-tight">
          Open your own stoop here.
        </p>
        <p className="mt-2 text-13 leading-relaxed text-surface/80">
          Bake, craft, tutor, meal-prep — anything you sell to neighbors. Free to start.
          Setup takes about five minutes.
        </p>
        <Link
          href="/signup"
          className="mt-3.5 inline-flex items-center gap-1.5 rounded-md bg-marigold px-3.5 py-2 font-sans text-13 font-bold text-ink shadow-stamp transition-[background-color,box-shadow,transform] duration-fast ease-stoop hover:bg-marigold-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris active:translate-y-px"
        >
          List your stoop here
          <ChevronRight aria-hidden="true" className="h-4 w-4 stroke-[1.75]" />
        </Link>
      </div>

      <p className="mt-4 text-center text-12 leading-relaxed text-ink-3">
        Stoop is a marketplace for residents of{" "}
        <b className="break-words font-semibold text-ink-2">{buildingName}</b>. We never
        publish unit numbers or contact details.
      </p>

      <footer className="mt-6 flex flex-col items-center border-t border-line pt-6">
        <Link
          aria-label="Stoop home"
          className="inline-flex items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris"
          href="/"
        >
          <Logo size={26} variant="wordmark" />
        </Link>
        <p className="ab-caption mt-2 text-ink-3">Powered by Stoop</p>
      </footer>
    </>
  );
}
