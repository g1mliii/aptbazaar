import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requiredEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

let secretClient: SupabaseClient<Database> | null = null;

export function createSupabaseSecretClient() {
  if (secretClient) {
    return secretClient;
  }

  secretClient = createClient<Database>(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SECRET_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
  return secretClient;
}
