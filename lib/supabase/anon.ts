import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requiredEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

let anonClient: SupabaseClient<Database> | null = null;

export function createSupabaseAnonClient() {
  if (anonClient) {
    return anonClient;
  }

  anonClient = createClient<Database>(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  return anonClient;
}
