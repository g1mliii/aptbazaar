import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/app/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What Stoop collects, who processes it, and how to get it removed."
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="June 2026"
      intro="Stoop helps local sellers take orders and payments from a QR code. This page explains what we collect, who helps us process it, and how to have it removed. We keep it plain on purpose."
    >
      <LegalSection heading="What we collect">
        <p>We collect only what it takes to run a store and complete an order:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <b>Seller info:</b> your name, email, and (if you add them) phone number and a
            mailing address used for the anti-spam footer on emails you send. Plus your store
            details — name, description, products, prices, photos, and pickup notes.
          </li>
          <li>
            <b>Customer order info:</b> the name, email, and phone number a customer enters at
            checkout, their order items, any order notes, and pickup details. Customers never
            create an account — we track orders with a private link instead.
          </li>
          <li>
            <b>Building info:</b> a normalized street address and postal code used to group
            sellers in the same building. We strip and never store apartment or unit numbers,
            and they never appear on any public page.
          </li>
          <li>
            <b>Subscriber emails:</b> if a customer opts in to hear about your drops, we store
            their email so we can send those notifications.
          </li>
          <li>
            <b>Photos:</b> product and logo images you upload. We strip location and camera
            metadata (EXIF) and re-encode them before storing.
          </li>
          <li>
            <b>Payment references:</b> Stripe processes the actual payment. We store the Stripe
            identifiers that tie an order to its charge — never card numbers or bank details.
          </li>
          <li>
            <b>Basic analytics:</b> aggregate QR-scan counts by channel. These hold no personal
            information.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Who processes it">
        <p>We use a small set of trusted processors and nothing else:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <b>Stripe</b> — payments and payouts. Card and bank details live with Stripe, not
            with us. Stripe&apos;s own privacy terms govern that data.
          </li>
          <li>
            <b>Supabase</b> — our database, seller sign-in, and file storage.
          </li>
          <li>
            <b>Cloudflare</b> — hosting, the R2 object storage that holds your images, and the
            email service that sends order and drop emails.
          </li>
          <li>
            <b>Sentry</b> — error monitoring so we can fix problems. It may record technical
            details of an error, kept to the minimum needed to debug.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="How long we keep it">
        <p>
          We keep store and order records for as long as your store is open, so you and your
          customers have an accurate history. Customer order-tracking links expire roughly 90
          days after an order is completed. When you close your store, we remove your data on
          the schedule described below.
        </p>
      </LegalSection>

      <LegalSection heading="Deleting your account">
        <p>
          You can have your store and its data deleted at any time. Email{" "}
          <a href="mailto:help@stoop.app" className="font-semibold text-verdigris">
            help@stoop.app
          </a>{" "}
          from your account email and we&apos;ll remove your store, products, images, and
          subscriber list. Some records tied to completed payments may be retained where the law
          or Stripe requires it.
        </p>
      </LegalSection>

      <LegalSection heading="Email and unsubscribing">
        <p>
          Order emails are transactional — they confirm something a customer asked for. Drop
          notifications are optional and every one carries a one-click unsubscribe link and the
          sender&apos;s mailing address, as anti-spam law (CASL and CAN-SPAM) requires.
          Unsubscribing takes effect immediately and needs no account.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          If we change this policy we&apos;ll update the date at the top. For anything material,
          we&apos;ll let active sellers know by email.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
