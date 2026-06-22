import { emailFooter as footer, escapeHtml } from "@/lib/email/html";
import type { OrderStatus } from "@/lib/schemas/order";

// Phase 6.3: customer-facing status-transition emails. One builder, per-status copy. Kit voice:
// sentence case, second-person, plain copy, no emoji, no error codes — matching order-confirmation.
// `ready` is the key "come get it" email. There is no email for `new` (that's the confirmation).

type OrderStatusEmailArgs = {
  status: Exclude<OrderStatus, "new">;
  storeName: string;
  trackingUrl: string;
  pickupNote?: string | null;
  footerAddress?: string;
};

type BuiltEmail = { subject: string; html: string; text: string };

type Copy = {
  subject: (storeName: string) => string;
  lead: string;
  body: (storeName: string) => string;
};

const COPY: Record<OrderStatusEmailArgs["status"], Copy> = {
  accepted: {
    subject: (s) => `${s} accepted your order`,
    lead: "Your order's accepted.",
    body: (s) => `${s} has your order and will start on it soon.`
  },
  preparing: {
    subject: (s) => `${s} is on your order`,
    lead: "Your order's being made.",
    body: (s) => `${s} is preparing your order now. We'll let you know the moment it's ready.`
  },
  ready: {
    subject: (s) => `Your order at ${s} is ready`,
    lead: "Your order's ready for pickup.",
    body: (s) => `Come grab it from ${s}.`
  },
  complete: {
    subject: (s) => `Thanks from ${s}`,
    lead: "Picked up — thanks.",
    body: (s) => `That's a wrap on this order. Thanks for ordering from ${s}.`
  },
  cancelled: {
    subject: (s) => `Your order at ${s} was cancelled`,
    lead: "Your order was cancelled.",
    body: (s) => `${s} cancelled this order. Reach out to them if that's a surprise.`
  }
};

export function buildOrderStatusEmail(args: OrderStatusEmailArgs): BuiltEmail {
  const c = COPY[args.status];
  const f = footer(args.footerAddress);
  // The pickup hint only adds value on the "ready" email.
  const pickup = args.status === "ready" && args.pickupNote ? `Pickup: ${args.pickupNote}` : null;

  const text = [
    c.lead,
    c.body(args.storeName),
    pickup,
    ``,
    `Track your order: ${args.trackingUrl}`,
    ``,
    f.text
  ]
    .filter((l) => l !== null)
    .join("\n");

  const html = [
    `<p style="font-size:18px;">${escapeHtml(c.lead)}</p>`,
    `<p>${escapeHtml(c.body(args.storeName))}</p>`,
    pickup ? `<p>${escapeHtml(pickup)}</p>` : "",
    `<p><a href="${args.trackingUrl}">Track your order</a></p>`,
    f.html
  ]
    .filter(Boolean)
    .join("");

  return { subject: c.subject(args.storeName), html, text };
}
