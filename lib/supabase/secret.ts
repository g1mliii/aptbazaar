import "server-only";

import { createClient } from "@supabase/supabase-js";

import { requiredEnv } from "@/lib/env";

export function createSupabaseSecretClient() {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SECRET_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
}
