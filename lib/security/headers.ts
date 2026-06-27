export type SecurityHeader = {
  key: string;
  value: string;
};

// Phase 9.2: CSP is now enforced (was report-only in Phase 1.7). Directives are scoped to what the
// app actually loads:
//   - script/frame/connect include Cloudflare Turnstile (challenges.cloudflare.com) and Stripe.
//   - img-src is narrowed from `https:` to the R2 upload hosts (the *.r2.dev default plus the
//     custom uploads domain serving NEXT_PUBLIC_UPLOADS_BASE_URL) + Supabase storage. Keep this in
//     sync with next.config.ts `images.remotePatterns`.
//   - style-src keeps 'unsafe-inline': Tailwind injects inline styles and Next.js emits inline
//     <style> for critical CSS. This is an accepted, documented carve-out — revisit with nonces
//     post-v1 if we drop the inline-style dependency.
//   - script-src keeps 'unsafe-inline': the App Router bootstraps and streams the RSC payload via
//     inline <script> tags (self.__next_f / self.__next_r). A nonce would require per-request
//     dynamic rendering (no static prerender / edge cache), so we accept inline scripts and rely on
//     the host allowlist + 'unsafe-eval' being absent. Revisit with a nonce middleware post-v1.
const cspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https://*.r2.dev https://uploads.stoop.app https://*.supabase.co",
  "font-src 'self' https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://challenges.cloudflare.com",
  "connect-src 'self' https://*.supabase.co https://*.ingest.sentry.io https://*.sentry.io https://api.stripe.com https://challenges.cloudflare.com",
  "frame-src https://js.stripe.com https://checkout.stripe.com https://challenges.cloudflare.com"
];

export const contentSecurityPolicy = cspDirectives.join("; ");

export const securityHeaders: SecurityHeader[] = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload"
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff"
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin"
  },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(self), browsing-topics=()"
  },
  {
    key: "X-Frame-Options",
    value: "DENY"
  }
];
