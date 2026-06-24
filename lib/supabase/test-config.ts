import { appEnvironment } from "@/lib/env";

// Test-only escape hatch: in the test env the Supabase clients throw when their env vars are unset.
// Public pages treat that as notFound() rather than a crash. Centralized so every public surface
// agrees on what counts as a missing-config error (and so the list grows in one place).
export function isTestSupabaseConfigError(error: unknown): boolean {
  if (appEnvironment !== "test" || !(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes("NEXT_PUBLIC_SUPABASE_URL is required") ||
    error.message.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required") ||
    error.message.includes("Invalid supabaseUrl") ||
    error.message.includes("SUPABASE_SECRET_KEY is required")
  );
}
