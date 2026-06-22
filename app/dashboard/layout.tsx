import type { ReactNode } from "react";

import { requireSeller } from "@/lib/auth/session";
import { storefrontUrl } from "@/lib/qr/poster";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { DashboardChrome } from "./dashboard-chrome";

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) {
    return "ST";
  }
  if (words.length === 1) {
    return first.slice(0, 2).toUpperCase();
  }
  const last = words[words.length - 1] ?? first;
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const seller = await requireSeller();

  const supabase = await createSupabaseServerClient();
  const { data: store } = await supabase
    .from("stores")
    .select("name, slug")
    .eq("seller_id", seller.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const storeName = store?.name ?? seller.display_name;
  const publicUrl = store?.slug ? `${storefrontUrl(store.slug)}?preview=1` : "#";

  return (
    <DashboardChrome
      storeName={storeName}
      publicUrl={publicUrl}
      initials={initialsFor(storeName)}
    >
      {children}
    </DashboardChrome>
  );
}
