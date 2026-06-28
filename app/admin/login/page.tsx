import type { Metadata } from "next";

import { AdminLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Founder access",
  robots: { index: false, follow: false }
};

export default function AdminLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <AdminLoginForm />
    </main>
  );
}
