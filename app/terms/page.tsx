import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/app/components/legal/legal-page";
import { formatBps, PLATFORM_FEE_BPS } from "@/lib/pricing/fee";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The agreement between Stoop and the sellers who use it."
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      updated="June 2026"
      intro="These terms cover using Stoop to run your store. By opening a stoop you agree to them. We've kept them short and readable."
    >
      <LegalSection heading="What Stoop is">
        <p>
          Stoop gives you a QR storefront so customers can order and pay without DMs. You sell
          your own products under your own name. Stoop is the tool — you run the business.
        </p>
      </LegalSection>

      <LegalSection heading="Your responsibilities">
        <p>
          When you open a stoop you confirm that you&apos;re responsible for following local
          laws, building rules, food safety, allergen disclosure, and collecting and remitting
          any sales tax you owe. Stoop doesn&apos;t moderate compliance and doesn&apos;t file
          taxes for you. You&apos;re responsible for the accuracy of your listings and for
          fulfilling the orders your customers place.
        </p>
      </LegalSection>

      <LegalSection heading="Payments and our fee">
        <p>
          Payments run through Stripe Connect. Money flows from your customer to your own
          connected Stripe account and out to your bank — Stoop never holds your funds. Stripe
          owns the money screens: charges, payouts, refund history, bank changes, and tax forms
          all live in your Stripe Express dashboard.
        </p>
        <p>
          Stoop takes a platform fee of {formatBps(PLATFORM_FEE_BPS)} on each paid order,
          collected automatically through Stripe at the time of the charge. Pay-at-pickup orders
          settle in cash between you and your customer, outside Stripe.
        </p>
      </LegalSection>

      <LegalSection heading="Sales tax">
        <p>
          Stoop does not calculate, collect, or remit sales tax in v1 — we don&apos;t run Stripe
          Tax. You are responsible for deciding whether you need to register and charge tax. That
          may include the Canadian GST/HST small-supplier threshold, Quebec QST, or US state
          sales-tax nexus, depending on where and how much you sell. If in doubt, talk to a tax
          professional.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <p>
          Don&apos;t use Stoop to sell anything illegal, to mislead customers, or to send mail
          people didn&apos;t ask for. Don&apos;t try to break, overload, or probe the platform.
          We can suspend or close a store that breaks these terms.
        </p>
      </LegalSection>

      <LegalSection heading="No warranty and liability">
        <p>
          Stoop is provided as-is. We work hard to keep it running, but we can&apos;t promise it
          will always be available or error-free. To the extent the law allows, Stoop isn&apos;t
          liable for lost sales, lost data, or other indirect damages arising from using the
          service.
        </p>
      </LegalSection>

      <LegalSection heading="Ending your use">
        <p>
          You can close your store at any time — email{" "}
          <a href="mailto:help@stoop.app" className="font-semibold text-verdigris">
            help@stoop.app
          </a>
          . We can also end access if these terms are broken. See the{" "}
          <a href="/privacy" className="font-semibold text-verdigris">
            privacy policy
          </a>{" "}
          for what happens to your data afterward.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          If we change these terms we&apos;ll update the date above and, for material changes,
          email active sellers. Continuing to use Stoop after a change means you accept it.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
