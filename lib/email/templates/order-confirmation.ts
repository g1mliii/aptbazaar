import { emailFooter as footer, escapeHtml } from "@/lib/email/html";
import { formatMoney } from "@/lib/pricing/currency";
import type { PaymentMode } from "@/lib/schemas/order";

// Phase 4.5 templates. Kit voice: sentence case, second-person, plain copy, no emoji, no error
// codes. Money is mono + tabular in the product UI; email clients strip most styling, so here we
// keep a monospace span for figures and lean on plain alignment.

export type OrderEmailLine = {
  name: string;
  quantity: number;
  priceCents: number;
};

type OrderEmailArgs = {
  storeName: string;
  customerName: string;
  lines: OrderEmailLine[];
  totalCents: number;
  paymentMode: PaymentMode;
  pickupWindow: string | null;
  footerAddress?: string;
};

type CustomerArgs = OrderEmailArgs & { trackingUrl: string };
type SellerArgs = OrderEmailArgs & { dashboardUrl: string };

function linesText(lines: OrderEmailLine[]): string {
  return lines
    .map(
      (l) =>
        `${l.quantity} × ${l.name} — ${formatMoney(l.priceCents * l.quantity)}`
    )
    .join("\n");
}

function linesHtml(lines: OrderEmailLine[]): string {
  return lines
    .map(
      (l) =>
        `<tr><td style="padding:4px 0;">${l.quantity} × ${escapeHtml(l.name)}</td>` +
        `<td style="padding:4px 0;text-align:right;font-family:monospace;">${formatMoney(
          l.priceCents * l.quantity
        )}</td></tr>`
    )
    .join("");
}

function paymentLine(mode: PaymentMode): string {
  if (mode === "free") return "On the house — nothing to pay.";
  return mode === "online"
    ? "You'll pay online to complete this order."
    : "Pay at pickup.";
}

export function buildCustomerOrderEmail(args: CustomerArgs): {
  subject: string;
  html: string;
  text: string;
} {
  const f = footer(args.footerAddress);
  const pickup = args.pickupWindow ? `Pickup: ${args.pickupWindow}` : null;

  const text = [
    `Your order's in.`,
    `We'll email you when it's ready for pickup at ${args.storeName}.`,
    ``,
    linesText(args.lines),
    `Total — ${formatMoney(args.totalCents)}`,
    paymentLine(args.paymentMode),
    pickup,
    ``,
    `Track your order: ${args.trackingUrl}`,
    `Save this link — it's how you check your order. No account needed.`,
    ``,
    f.text
  ]
    .filter((l) => l !== null)
    .join("\n");

  const html = [
    `<p style="font-size:18px;">Your order's in.</p>`,
    `<p>We'll email you when it's ready for pickup at ${escapeHtml(
      args.storeName
    )}.</p>`,
    `<table style="width:100%;border-collapse:collapse;">${linesHtml(args.lines)}`,
    `<tr><td style="padding:8px 0;border-top:1px dashed #ccc;font-weight:600;">Total</td>` +
      `<td style="padding:8px 0;border-top:1px dashed #ccc;text-align:right;font-family:monospace;font-weight:600;">${formatMoney(
        args.totalCents
      )}</td></tr></table>`,
    `<p>${paymentLine(args.paymentMode)}</p>`,
    pickup ? `<p>${escapeHtml(pickup)}</p>` : "",
    `<p><a href="${args.trackingUrl}">Track your order</a></p>`,
    `<p style="color:#7a766c;font-size:13px;">Save this link — it's how you check your order. No account needed.</p>`,
    f.html
  ]
    .filter(Boolean)
    .join("");

  return { subject: `Your order at ${args.storeName} is in`, html, text };
}

export function buildSellerOrderEmail(args: SellerArgs): {
  subject: string;
  html: string;
  text: string;
} {
  const f = footer(args.footerAddress);
  const pickup = args.pickupWindow ? `Pickup: ${args.pickupWindow}` : null;

  const text = [
    `New order at ${args.storeName}.`,
    `From ${args.customerName}.`,
    ``,
    linesText(args.lines),
    `Total — ${formatMoney(args.totalCents)}`,
    paymentLine(args.paymentMode),
    pickup,
    ``,
    `Open it in your dashboard: ${args.dashboardUrl}`,
    ``,
    f.text
  ]
    .filter((l) => l !== null)
    .join("\n");

  const html = [
    `<p style="font-size:18px;">New order at ${escapeHtml(args.storeName)}.</p>`,
    `<p>From ${escapeHtml(args.customerName)}.</p>`,
    `<table style="width:100%;border-collapse:collapse;">${linesHtml(args.lines)}`,
    `<tr><td style="padding:8px 0;border-top:1px dashed #ccc;font-weight:600;">Total</td>` +
      `<td style="padding:8px 0;border-top:1px dashed #ccc;text-align:right;font-family:monospace;font-weight:600;">${formatMoney(
        args.totalCents
      )}</td></tr></table>`,
    `<p>${paymentLine(args.paymentMode)}</p>`,
    pickup ? `<p>${escapeHtml(pickup)}</p>` : "",
    `<p><a href="${args.dashboardUrl}">Open it in your dashboard</a></p>`,
    f.html
  ]
    .filter(Boolean)
    .join("");

  return { subject: `New order at ${args.storeName}`, html, text };
}
