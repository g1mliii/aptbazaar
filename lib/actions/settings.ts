"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { resolveReadyImageUploadUrl } from "@/lib/actions/images";
import { writeAuditLog } from "@/lib/audit/log";
import { phoneE164 } from "@/lib/schemas/common";
import { fieldErrorsFrom } from "@/lib/schemas/field-errors";
import { pickupMethodSchema, storeVisibilitySchema } from "@/lib/schemas/store";
import { screenStoreName } from "@/lib/security/store-name";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { containsLikelyUnitNumber } from "@/lib/utils/normalize-address";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesUpdate } from "@/lib/supabase/database.types";

// Phase 3.6: settings mutations. Store/contact edits go through the user-scoped client (RLS owner
// policies); account deletion is audit-logged and then performed with the service role (only it can
// remove the auth.users row, which cascades to the whole tenant).

type Db = SupabaseClient<Database>;
type StoreUpdate = TablesUpdate<"stores">;

export type SettingsResult =
  | { ok: true }
  | { ok: false; fieldErrors?: Record<string, string>; error?: string };

const optionalText = z
  .string()
  .trim()
  .max(280)
  .optional()
  .or(z.literal("").transform(() => undefined));

const pickupPublicNote = optionalText.refine(
  (value) => !value || !containsLikelyUnitNumber(value),
  "Keep unit numbers out of public pickup notes."
);

const pickupWindowLabel = z
  .string()
  .trim()
  .max(80)
  .optional()
  .or(z.literal("").transform(() => undefined))
  .refine(
    (value) => !value || !containsLikelyUnitNumber(value),
    "Keep unit numbers out of public pickup times."
  );

const storeSettingsSchema = z.object({
  name: z.string().trim().min(1, "Give your stoop a name.").max(80),
  category: z.string().trim().max(60).optional().or(z.literal("")),
  description: optionalText,
  visibility: storeVisibilitySchema,
  pickup_method: pickupMethodSchema,
  pickup_window_label: pickupWindowLabel,
  pickup_public_note: pickupPublicNote,
  accept_pay_at_pickup: z.boolean(),
  logo_upload_id: z.string().uuid().nullish(),
  clear_logo: z.boolean().optional()
});

const contactSchema = z.object({
  display_name: z.string().trim().min(1, "Add your name.").max(80),
  contact_phone_e164: phoneE164.optional().or(z.literal("").transform(() => undefined)),
  contact_address: z.string().trim().max(200).optional().or(z.literal(""))
});

async function currentStoreId(supabase: Db): Promise<string | null> {
  const { data } = await supabase
    .from("stores")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function updateStoreSettings(input: unknown): Promise<SettingsResult> {
  const parsed = storeSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const nameScreen = screenStoreName(parsed.data.name);
  if (nameScreen.action === "block") {
    return {
      ok: false,
      fieldErrors: { name: "That name won't work — try another one." }
    };
  }

  const supabase = await createSupabaseServerClient();
  const storeId = await currentStoreId(supabase);
  if (!storeId) {
    return { ok: false, error: "We couldn't find your store." };
  }

  const updatePayload: StoreUpdate = {
    name: parsed.data.name,
    category: parsed.data.category || null,
    description: parsed.data.description ?? null,
    visibility: parsed.data.visibility,
    pickup_method: parsed.data.pickup_method,
    pickup_window_label: parsed.data.pickup_window_label || null,
    pickup_public_note: parsed.data.pickup_public_note ?? null,
    accept_pay_at_pickup: parsed.data.accept_pay_at_pickup
  };

  if (parsed.data.logo_upload_id) {
    const resolved = await resolveReadyImageUploadUrl(
      supabase,
      storeId,
      parsed.data.logo_upload_id
    );
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }
    updatePayload.logo_url = resolved.url;
  } else if (parsed.data.clear_logo) {
    updatePayload.logo_url = null;
  }

  const { error } = await supabase
    .from("stores")
    .update(updatePayload)
    .eq("id", storeId);

  if (error) {
    return { ok: false, error: "We couldn't save your changes." };
  }

  if (nameScreen.action !== "allow") {
    try {
      await writeAuditLog({
        actorType: "system",
        action: "store_name_flagged",
        targetTable: "stores",
        targetId: storeId,
        payload: {
          storeName: parsed.data.name,
          tier: nameScreen.action,
          terms: nameScreen.terms
        }
      });
    } catch {
      // Review queue observability should not block a saved settings change.
    }
  }

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function updateContactInfo(input: unknown): Promise<SettingsResult> {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Please sign in." };
  }

  const { error } = await supabase
    .from("sellers")
    .update({
      display_name: parsed.data.display_name,
      contact_phone_e164: parsed.data.contact_phone_e164 ?? null,
      contact_address: parsed.data.contact_address || null
    })
    .eq("user_id", user.id);

  if (error) {
    return { ok: false, error: "We couldn't save your changes." };
  }

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function setStoreActive(isActive: boolean): Promise<SettingsResult> {
  const supabase = await createSupabaseServerClient();
  const storeId = await currentStoreId(supabase);
  if (!storeId) {
    return { ok: false, error: "We couldn't find your store." };
  }
  const { error } = await supabase
    .from("stores")
    .update({ is_active: isActive })
    .eq("id", storeId);
  if (error) {
    return { ok: false, error: "We couldn't update your store." };
  }
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

const DELETE_CONFIRMATION = "delete my account";

export async function deleteAccount(confirmation: string): Promise<SettingsResult> {
  if (confirmation.trim().toLowerCase() !== DELETE_CONFIRMATION) {
    return { ok: false, error: "Type the confirmation to delete your account." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: seller } = await supabase
    .from("sellers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  await writeAuditLog({
    actorType: "seller",
    actorId: user.id,
    action: "account.delete",
    targetTable: "sellers",
    targetId: seller?.id ?? null,
    payload: { email: user.email ?? null }
  });

  // Only the service role can remove the auth.users row, which cascades to sellers → stores →
  // products / orders / image_uploads via ON DELETE CASCADE.
  const secret = createSupabaseSecretClient();
  const { error: deleteError } = await secret.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return {
      ok: false,
      error: "We couldn't delete your account — try again."
    };
  }

  await supabase.auth.signOut();
  redirect("/login");
}
