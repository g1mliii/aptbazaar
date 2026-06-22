import { escapeHtml } from "@/lib/email/html";

// Phase 6.5: the seller's drop email. Unlike the order emails this carries the SELLER'S identity,
// not just the Stoop brand — anti-spam law (CAN-SPAM / CASL) requires the sender's physical mailing
// address and a working unsubscribe in every commercial broadcast. The seller authors the subject +
// body as plain text; we escape everything and preserve their line breaks. The footer block is
// drop-specific (seller name + address + per-store unsubscribe link), so it lives here rather than
// reusing the brand-only emailFooter().

type DropEmailArgs = {
  storeName: string;
  sellerDisplayName: string;
  contactAddress: string;
  subject: string;
  bodyText: string;
  unsubscribeUrl: string;
};

type BuiltEmail = { subject: string; html: string; text: string };

/** Render the seller's plain-text body as HTML paragraphs, preserving their line breaks. */
function bodyToHtml(bodyText: string): string {
  return bodyText
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

export function buildDropEmail(args: DropEmailArgs): BuiltEmail {
  const footerText = [
    ``,
    `—`,
    args.sellerDisplayName,
    args.contactAddress,
    ``,
    `Unsubscribe from ${args.storeName}'s drops: ${args.unsubscribeUrl}`
  ].join("\n");

  const text = [args.bodyText, footerText].join("\n");

  const footerHtml = [
    `<hr style="border:none;border-top:1px solid #e6e2d8;margin:24px 0 12px;"/>`,
    `<p style="color:#7a766c;font-size:12px;margin:0;">`,
    `${escapeHtml(args.sellerDisplayName)}<br/>`,
    `${escapeHtml(args.contactAddress)}<br/>`,
    `<a href="${escapeHtml(args.unsubscribeUrl)}">Unsubscribe from ${escapeHtml(
      args.storeName
    )}'s drops.</a>`,
    `</p>`
  ].join("");

  const html = [bodyToHtml(args.bodyText), footerHtml].join("");

  return { subject: args.subject, html, text };
}
