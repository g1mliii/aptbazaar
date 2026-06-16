// Loads .env.local (gitignored) so `npm run test:integration` picks up SUPABASE_URL,
// SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY locally without exporting them by hand.
// In CI the vars come from the job env instead, and this is a no-op.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fall back to process.env / the local-supabase defaults in helpers.
}
