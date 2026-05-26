# Security policy

aptbazaar handles payment information and customer order data on behalf of independent sellers. We take security seriously.

## Supported versions

Only the latest production deploy on `main` is supported. There are no long-lived release branches.

## Reporting a vulnerability

**Do not file a public GitHub issue for security vulnerabilities.**

Email reports to:

**security@aptbazaar** *(replace once the production domain is configured)*

Please include:

- A description of the issue and where it lives (file path, route, or product surface)
- Steps to reproduce
- The impact you believe the issue has (data leak, account takeover, tenant isolation break, etc.)
- Any suggested fix or mitigation, if known

We will:

- Acknowledge receipt within 3 business days
- Provide an initial triage and severity assessment within 7 business days
- Coordinate a disclosure timeline once a fix is in place

## In scope

- Tenant isolation bugs (one seller reading or writing another seller's data)
- Unauthorized access to customer order data via tracking tokens or otherwise
- Stripe payment flow vulnerabilities (fund custody, fee bypass, webhook replay)
- Webhook signature bypass
- XSS, CSRF, SQL injection
- Authentication or authorization bypass on seller or admin routes
- PII leakage in any public API response (customer email/phone, address, unit number)
- Image upload bypass (SVG, EXIF, oversized, MIME mismatch, animated WebP/GIF)
- Rate limit bypass on order placement, subscriber capture, or image upload
- Privacy regressions on the building bazaar surface

## Out of scope

- Social engineering of aptbazaar staff or sellers
- Physical attacks on infrastructure
- Denial of service attacks
- Issues in third-party services (Stripe, Supabase, Cloudflare, Resend) — report to those vendors directly
- Anything requiring a logged-in seller to attack their own account
- Self-XSS
- Missing best-practice headers that have no exploitable impact

## Acknowledgment

We do not currently offer a paid bug bounty. With your permission, we will publicly acknowledge security researchers who report valid issues.
