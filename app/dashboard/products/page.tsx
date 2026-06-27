import { productRowSchema, type Product } from "@/lib/schemas/product";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ProductsScreen } from "./products-screen";

const PRODUCT_COLUMNS =
  "id, store_id, name, description, price_cents, currency, image_url, image_alt, qty_available, max_per_order, is_active, allergens, ingredients, created_at, updated_at";

export default async function ProductsPage() {
  // The dashboard layout already gates on requireSeller(); RLS scopes these reads to the owner.
  const supabase = await createSupabaseServerClient();
  const { data: store } = await supabase
    .from("stores")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let products: Product[] = [];
  if (store) {
    const { data } = await supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("store_id", store.id)
      .order("created_at", { ascending: false });
    products = (data ?? []).map((row) => productRowSchema.parse(row));
  }

  return <ProductsScreen storeId={store?.id ?? ""} initialProducts={products} />;
}
