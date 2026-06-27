"use server";

import { revalidatePath } from "next/cache";

import { resolveReadyImageUploadUrl } from "@/lib/actions/images";
import { fieldErrorsFrom } from "@/lib/schemas/field-errors";
import {
  productInputSchema,
  productRowSchema,
  type Product
} from "@/lib/schemas/product";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesUpdate } from "@/lib/supabase/database.types";

// Phase 3.4: product mutations. Every action validates with Zod before any DB call and relies on
// RLS (products_owner_all) to enforce tenant isolation — the store_id is resolved server-side
// from the caller's own store, never trusted from the client.

const PRODUCT_COLUMNS =
  "id, store_id, name, description, price_cents, currency, image_url, image_alt, qty_available, max_per_order, is_active, allergens, ingredients, created_at, updated_at";

export type ProductActionResult =
  | { ok: true; product: Product }
  | { ok: false; fieldErrors?: Record<string, string>; error?: string };

type Db = SupabaseClient<Database>;
type ProductUpdate = TablesUpdate<"products">;

async function currentStoreId(supabase: Db): Promise<string | null> {
  // RLS limits this select to the caller's own store(s).
  const { data } = await supabase
    .from("stores")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function createProduct(input: unknown): Promise<ProductActionResult> {
  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const supabase = await createSupabaseServerClient();
  const storeId = await currentStoreId(supabase);
  if (!storeId) {
    return { ok: false, error: "We couldn't find your store." };
  }

  let imageUrl: string | null = null;
  if (parsed.data.image_upload_id) {
    const resolved = await resolveReadyImageUploadUrl(
      supabase,
      storeId,
      parsed.data.image_upload_id
    );
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }
    imageUrl = resolved.url;
  }

  const { data, error } = await supabase
    .from("products")
    .insert({
      store_id: storeId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      price_cents: parsed.data.price_cents,
      image_url: imageUrl,
      // Alt only travels with an image; the schema guarantees it's present when one is attached.
      image_alt: imageUrl ? (parsed.data.image_alt ?? null) : null,
      qty_available: parsed.data.qty_available ?? null,
      max_per_order: parsed.data.max_per_order ?? null,
      is_active: parsed.data.is_active,
      allergens: parsed.data.allergens,
      ingredients: parsed.data.ingredients ?? null
    })
    .select(PRODUCT_COLUMNS)
    .single();

  if (error || !data) {
    return { ok: false, error: "We couldn't save that product." };
  }

  revalidatePath("/dashboard/products");
  return { ok: true, product: productRowSchema.parse(data) };
}

export async function updateProduct(
  productId: string,
  input: unknown
): Promise<ProductActionResult> {
  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const supabase = await createSupabaseServerClient();
  const storeId = await currentStoreId(supabase);
  if (!storeId) {
    return { ok: false, error: "We couldn't find your store." };
  }

  const { data: current } = await supabase
    .from("products")
    .select("image_url, image_alt")
    .eq("id", productId)
    .eq("store_id", storeId)
    .maybeSingle();
  if (!current) {
    return { ok: false, error: "We couldn't save that product." };
  }

  const updatePayload: ProductUpdate = {
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    price_cents: parsed.data.price_cents,
    qty_available: parsed.data.qty_available ?? null,
    max_per_order: parsed.data.max_per_order ?? null,
    is_active: parsed.data.is_active,
    allergens: parsed.data.allergens,
    ingredients: parsed.data.ingredients ?? null
  };

  if (parsed.data.image_upload_id) {
    const resolved = await resolveReadyImageUploadUrl(
      supabase,
      storeId,
      parsed.data.image_upload_id
    );
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }
    updatePayload.image_url = resolved.url;
    updatePayload.image_alt = parsed.data.image_alt ?? null;
  } else if (parsed.data.clear_image) {
    updatePayload.image_url = null;
    updatePayload.image_alt = null;
  } else if (parsed.data.image_alt !== undefined) {
    // Let a seller fix the alt text on an existing photo without re-uploading it.
    updatePayload.image_alt = parsed.data.image_alt.trim() || null;
  }

  const nextHasImage =
    updatePayload.image_url !== null && (updatePayload.image_url ?? current.image_url) !== null;
  const nextAlt = updatePayload.image_alt ?? current.image_alt ?? "";
  if (nextHasImage && nextAlt.trim().length < 3) {
    return {
      ok: false,
      fieldErrors: {
        image_alt: "Describe the photo in a few words so everyone can picture it."
      }
    };
  }

  const { data, error } = await supabase
    .from("products")
    .update(updatePayload)
    .eq("id", productId)
    .select(PRODUCT_COLUMNS)
    .single();

  if (error || !data) {
    return { ok: false, error: "We couldn't save that product." };
  }

  revalidatePath("/dashboard/products");
  return { ok: true, product: productRowSchema.parse(data) };
}

export async function setProductActive(
  productId: string,
  isActive: boolean
): Promise<ProductActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .update({ is_active: isActive })
    .eq("id", productId)
    .select(PRODUCT_COLUMNS)
    .single();

  if (error || !data) {
    return { ok: false, error: "We couldn't update that product." };
  }

  revalidatePath("/dashboard/products");
  return { ok: true, product: productRowSchema.parse(data) };
}

export async function deleteProduct(productId: string): Promise<{ ok: boolean }> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("products").delete().eq("id", productId);
  if (error) {
    return { ok: false };
  }
  revalidatePath("/dashboard/products");
  return { ok: true };
}
