import { z } from "zod";

import { PUBLIC_SLUG_RE } from "@/lib/utils/slug";

import { timestamptz, uuid } from "./common";

export const buildingAccessTypeSchema = z.enum(["open", "invite"]);
export const membershipStatusSchema = z.enum(["pending", "active", "removed"]);

export type BuildingAccessType = z.infer<typeof buildingAccessTypeSchema>;
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const buildingRowSchema = z.object({
  id: uuid,
  normalized_key: z.string().min(1),
  display_name: z.string().min(1),
  city: z.string().nullable(),
  postal_code: z.string().nullable(),
  public_slug: z.string().regex(PUBLIC_SLUG_RE),
  access_type: buildingAccessTypeSchema,
  invite_code: z.string().nullable(),
  invite_code_rotated_at: timestamptz.nullable(),
  created_at: timestamptz
});

export type Building = z.infer<typeof buildingRowSchema>;

// Public projection: never carries invite_code, normalized_key, or postal_code.
export const buildingPublicSchema = buildingRowSchema.omit({
  invite_code: true,
  invite_code_rotated_at: true,
  normalized_key: true,
  postal_code: true
});

export type BuildingPublic = z.infer<typeof buildingPublicSchema>;

export const buildingMembershipRowSchema = z.object({
  id: uuid,
  building_id: uuid,
  store_id: uuid,
  status: membershipStatusSchema,
  invited_at: timestamptz.nullable(),
  joined_at: timestamptz.nullable(),
  created_at: timestamptz
});

export type BuildingMembership = z.infer<typeof buildingMembershipRowSchema>;
