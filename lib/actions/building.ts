"use server";

import { revalidatePath } from "next/cache";

import { writeAuditLog } from "@/lib/audit/log";
import { selectActiveBuilding } from "@/lib/queries/building-membership";
import { selectPrimaryStoreId } from "@/lib/queries/store";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateInviteCode } from "@/lib/utils/token";

// Phase 8.5: building invite-code administration. A building is shared by every member, so any
// member of it may flip it between open and invite-only and rotate the shared code. Reads run under
// the seller's JWT (RLS proves membership via buildings_member_select); the write goes through the
// secret client because authenticated has no UPDATE grant on buildings (the code is the shared
// secret). Every change is audit-logged.

export type BuildingAdminResult =
  | { ok: true; code: string | null }
  | { ok: false; error: string };

const ROTATE_CONFIRMATION = "rotate";

// Resolve the building the signed-in seller belongs to, proving membership through RLS.
async function memberBuildingId(): Promise<
  { buildingId: string; userId: string } | { error: string }
> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Please sign in." };
  }

  const storeId = await selectPrimaryStoreId(supabase);
  if (!storeId) {
    return { error: "We couldn't find your store." };
  }

  const { data: membership } = await selectActiveBuilding(supabase, storeId);
  if (!membership?.building_id) {
    return { error: "Your stoop isn't grouped into a building yet." };
  }

  return { buildingId: membership.building_id, userId: user.id };
}

/**
 * Turn invite-only mode on (minting a fresh code) or rotate an existing one. Both bump
 * invite_code_rotated_at, which immediately invalidates every cookie and printed poster bound to the
 * previous code. `confirmation` must equal "rotate" so the typed-confirmation dialog is honored.
 */
export async function rotateInviteCode(
  confirmation: string
): Promise<BuildingAdminResult> {
  if (confirmation.trim().toLowerCase() !== ROTATE_CONFIRMATION) {
    return { ok: false, error: "Type rotate to confirm." };
  }

  const resolved = await memberBuildingId();
  if ("error" in resolved) {
    return { ok: false, error: resolved.error };
  }

  const code = generateInviteCode(8);
  const secret = createSupabaseSecretClient();
  const { error } = await secret
    .from("buildings")
    .update({
      access_type: "invite",
      invite_code: code,
      invite_code_rotated_at: new Date().toISOString()
    })
    .eq("id", resolved.buildingId);
  if (error) {
    return { ok: false, error: "We couldn't update the invite code." };
  }

  await writeAuditLog({
    actorType: "seller",
    actorId: resolved.userId,
    action: "building.invite_rotated",
    targetTable: "buildings",
    targetId: resolved.buildingId
  });

  revalidatePath("/dashboard/settings");
  return { ok: true, code };
}

/** Revert a building to open access — anyone with the link reaches the bazaar; the code is cleared. */
export async function openBuildingAccess(): Promise<BuildingAdminResult> {
  const resolved = await memberBuildingId();
  if ("error" in resolved) {
    return { ok: false, error: resolved.error };
  }

  const secret = createSupabaseSecretClient();
  const { error } = await secret
    .from("buildings")
    .update({
      access_type: "open",
      invite_code: null,
      invite_code_rotated_at: new Date().toISOString()
    })
    .eq("id", resolved.buildingId);
  if (error) {
    return { ok: false, error: "We couldn't update building access." };
  }

  await writeAuditLog({
    actorType: "seller",
    actorId: resolved.userId,
    action: "building.opened",
    targetTable: "buildings",
    targetId: resolved.buildingId
  });

  revalidatePath("/dashboard/settings");
  return { ok: true, code: null };
}
