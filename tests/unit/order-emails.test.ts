import { describe, expect, it } from "vitest";

import {
  buildCustomerOrderEmail,
  buildSellerOrderEmail,
  type OrderEmailLine
} from "@/lib/email/templates/order-confirmation";

const lines: OrderEmailLine[] = [
  { name: "Brown butter cookies", quantity: 2, priceCents: 600 },
  { name: "Sourdough", quantity: 1, priceCents: 800 }
];

describe("buildCustomerOrderEmail", () => {
  const email = buildCustomerOrderEmail({
    storeName: "Priya's Kitchen",
    customerName: "Sam",
    trackingUrl: "https://stoop.app/o/tok123",
    lines,
    totalCents: 2000,
    paymentMode: "pay_at_pickup",
    pickupWindow: "Sat 9am–1pm",
    footerAddress: "123 Main St, Toronto"
  });

  it("uses the kit voice and carries the tracking link", () => {
    expect(email.text).toContain("Your order's in.");
    expect(email.html).toContain("https://stoop.app/o/tok123");
    expect(email.subject).toContain("Priya's Kitchen");
  });

  it("shows the server-computed total in dollars", () => {
    expect(email.text).toContain("$20");
    expect(email.html).toContain("$20");
  });

  it("includes the physical-address footer when provided", () => {
    expect(email.text).toContain("123 Main St, Toronto");
    expect(email.html).toContain("123 Main St, Toronto");
  });

  it("states the payment expectation for pay-at-pickup", () => {
    expect(email.text.toLowerCase()).toContain("pay at pickup");
  });
});

describe("buildSellerOrderEmail", () => {
  it("names the customer and links the dashboard", () => {
    const email = buildSellerOrderEmail({
      storeName: "Priya's Kitchen",
      customerName: "Sam <script>",
      dashboardUrl: "https://stoop.app/dashboard/orders",
      lines,
      totalCents: 2000,
      paymentMode: "pay_at_pickup",
      pickupWindow: null
    });
    expect(email.text).toContain("Sam");
    expect(email.html).toContain("https://stoop.app/dashboard/orders");
    // Customer-typed content is HTML-escaped, never injected raw.
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});
