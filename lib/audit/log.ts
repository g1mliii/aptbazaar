import "server-only";

import type { Json } from "@/lib/supabase/database.types";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";

// Phase 2.11: append-only audit trail for sensitive ops (refunds, store deletion,
// building admin overrides, drop sends). audit_log is service-role only (Phase 2.4),
// so this always goes through the secret client — never a user-scoped client.

export interface AuditEntry {
  actorType: "seller" | "system" | "anon" | "admin";
  actorId?: string | null;
  action: string;
  targetTable?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown> | null;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  const supabase = createSupabaseSecretClient();

  const { error } = await supabase.from("audit_log").insert({
    actor_type: entry.actorType,
    actor_id: entry.actorId ?? null,
    action: entry.action,
    target_table: entry.targetTable ?? null,
    target_id: entry.targetId ?? null,
    payload_jsonb: (entry.payload ?? null) as Json
  });

  if (error) {
    throw new Error(`audit_log write failed: ${error.message}`);
  }
}
