export type SecurityHeader = {
  key: string;
  value: string;
};

const cspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self'",
  "connect-src 'self' https://*.supabase.co https://*.ingest.sentry.io https://*.sentry.io https://api.stripe.com https://checkout.stripe.com",
  "frame-src https://js.stripe.com https://checkout.stripe.com"
];

export const contentSecurityPolicyReportOnly = cspDirectives.join("; ");

export const securityHeaders: SecurityHeader[] = [
  {
    key: "Content-Security-Policy-Report-Only",
    value: contentSecurityPolicyReportOnly
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
