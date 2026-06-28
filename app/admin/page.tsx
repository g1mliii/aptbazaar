import type { Metadata } from "next";

import { Card } from "@/app/components/ui/card";
import { loadAdminMetrics } from "@/lib/admin/load-metrics";
import type { TopBuilding, TopSeller } from "@/lib/admin/metrics";
import { formatMoney } from "@/lib/pricing/currency";

export const metadata: Metadata = {
  title: "Founder dashboard",
  robots: { index: false, follow: false }
};

// Metrics are live counts — never serve a cached page.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const metrics = await loadAdminMetrics();

  const kpis = [
    { label: "Stores", value: metrics.storeCount.toLocaleString("en-CA") },
    { label: "Products", value: metrics.productCount.toLocaleString("en-CA") },
    { label: "Paid orders", value: metrics.paidOrderCount.toLocaleString("en-CA") },
    { label: "GMV", value: formatMoney(metrics.gmvCents) },
    { label: "Platform fees", value: formatMoney(metrics.platformFeesCents) }
  ];

  return (
    <main className="min-h-screen bg-paper px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-12 uppercase tracking-[0.12em] text-verdigris">
          Founder dashboard
        </p>
        <h1 className="mt-2 font-display text-36 leading-none text-ink">How Stoop is doing</h1>
        <p className="mt-2 text-15 text-ink-2">
          Live across every store. Money and counts are in cents-accurate CAD.
        </p>

        <section
          aria-label="Key numbers"
          className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          {kpis.map((kpi) => (
            <Card key={kpi.label} className="p-4">
              <p className="text-13 text-ink-3">{kpi.label}</p>
              <p className="mt-1 font-mono text-24 font-semibold tabular-nums text-ink">
                {kpi.value}
              </p>
            </Card>
          ))}
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <TopSellersCard sellers={metrics.topSellers} />
          <TopBuildingsCard buildings={metrics.topBuildings} />
        </div>
      </div>
    </main>
  );
}

function TopSellersCard({ sellers }: { sellers: TopSeller[] }) {
  return (
    <Card>
      <h2 className="font-display text-24 text-ink">Top sellers by revenue</h2>
      {sellers.length === 0 ? (
        <p className="mt-3 text-14 text-ink-3">No paid orders yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {sellers.map((seller, index) => (
            <li
              key={seller.sellerId}
              className="flex items-baseline justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0"
            >
              <span className="flex items-baseline gap-2 truncate text-14 text-ink">
                <span className="font-mono text-13 tabular-nums text-ink-3">
                  {index + 1}
                </span>
                <span className="truncate">{seller.name}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="font-mono text-14 font-semibold tabular-nums text-ink">
                  {formatMoney(seller.gmvCents)}
                </span>
                <span className="ml-2 font-mono text-12 tabular-nums text-ink-3">
                  {seller.orderCount.toLocaleString("en-CA")} orders
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TopBuildingsCard({ buildings }: { buildings: TopBuilding[] }) {
  return (
    <Card>
      <h2 className="font-display text-24 text-ink">Top buildings by activity</h2>
      {buildings.length === 0 ? (
        <p className="mt-3 text-14 text-ink-3">No building activity yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {buildings.map((building, index) => (
            <li
              key={building.buildingId}
              className="flex items-baseline justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0"
            >
              <span className="flex items-baseline gap-2 truncate text-14 text-ink">
                <span className="font-mono text-13 tabular-nums text-ink-3">
                  {index + 1}
                </span>
                <span className="truncate">{building.name}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="font-mono text-14 font-semibold tabular-nums text-ink">
                  {formatMoney(building.gmvCents)}
                </span>
                <span className="ml-2 font-mono text-12 tabular-nums text-ink-3">
                  {building.orderCount.toLocaleString("en-CA")} orders
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
