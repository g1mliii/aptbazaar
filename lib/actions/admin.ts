"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_COOKIE_NAME,
  ADMIN_COOKIE_TTL_SECONDS,
  adminSecretMatches,
  signAdminSession
} from "@/lib/auth/admin-session";

// Phase 10.6: the /admin login gate. A correct shared secret mints the signed session cookie that
// the middleware checks on every /admin request, then we send the founder to the dashboard. A wrong
// secret returns a neighborly error — no error code, no enumeration of why.
export async function submitAdminLogin(
  secret: string
): Promise<{ error: string } | void> {
  if (!adminSecretMatches(secret)) {
    return { error: "That key didn't match. Check it and try again." };
  }

  const value = await signAdminSession(Date.now());
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin",
    maxAge: ADMIN_COOKIE_TTL_SECONDS
  });

  redirect("/admin");
}
