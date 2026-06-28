import type { Metadata } from "next";

import { SiteFooter } from "@/app/components/site-footer";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Open your stoop",
  description: "Set up your stoop in minutes. Take orders, not DMs."
};

export default function SignupPage() {
  return (
    <main className="min-h-screen bg-paper px-4 py-10 sm:px-6 sm:py-16">
      <SignupForm />
      <SiteFooter />
    </main>
  );
}
