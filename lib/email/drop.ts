import "server-only";

import { optionalEnv } from "@/lib/env";
import { sendEmail } from "@/lib/email/send-email";
import { buildDropEmail } from "@/lib/email/templates/drop";

// Phase 6.5: send one drop email to one recipient. Mirrors lib/email/order-status.ts — a thin
// wrapper over sendEmail that owns the template build plus the RFC 8058 one-click-unsubscribe
// headers Gmail/Apple Mail surface as a native "Unsubscribe" button. The URL form is required; the
// mailto is added when a from-address is configured. sendEmail already forwards `headers` through.

type SendDropArgs = {
  to: string;
  storeName: string;
  sellerDisplayName: string;
  contactAddress: string;
  subject: string;
  bodyText: string;
  /** Human-facing landing page (/u/[token]) — the body link. */
  unsubscribeUrl: string;
  /** RFC 8058 one-click POST target (/api/unsubscribe/[token]) — the List-Unsubscribe URL. */
  oneClickUrl: string;
};

export async function sendDropEmail(args: SendDropArgs): Promise<void> {
  const email = buildDropEmail({
    storeName: args.storeName,
    sellerDisplayName: args.sellerDisplayName,
    contactAddress: args.contactAddress,
    subject: args.subject,
    bodyText: args.bodyText,
    unsubscribeUrl: args.unsubscribeUrl
  });

  const fromEmail = optionalEnv("CLOUDFLARE_EMAIL_FROM");
  const listUnsubscribe = fromEmail
    ? `<${args.oneClickUrl}>, <mailto:${fromEmail}?subject=unsubscribe>`
    : `<${args.oneClickUrl}>`;

  await sendEmail({
    to: args.to,
    ...email,
    headers: {
      "List-Unsubscribe": listUnsubscribe,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    }
  });
}
