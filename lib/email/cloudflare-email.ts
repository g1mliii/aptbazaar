import { getCloudflareContext } from "@opennextjs/cloudflare";

import { optionalEnv } from "@/lib/env";

export type CloudflareEmailAddress = {
  email: string;
  name?: string;
};

export type CloudflareEmailPayload = {
  from: CloudflareEmailAddress;
  headers?: Record<string, string>;
  html: string;
  subject: string;
  text: string;
  to: string | string[];
};

export type CloudflareEmailBinding = {
  send(payload: CloudflareEmailPayload): Promise<unknown>;
};

export function getCloudflareEmailBinding() {
  const { env } = getCloudflareContext();
  const binding = (env as CloudflareEnv & { EMAIL?: CloudflareEmailBinding }).EMAIL;

  if (!binding) {
    throw new Error("Cloudflare Email binding EMAIL is required");
  }

  return binding;
}

export function isCloudflareEmailConfigured() {
  if (!optionalEnv("CLOUDFLARE_EMAIL_FROM")) {
    return false;
  }

  try {
    getCloudflareEmailBinding();
    return true;
  } catch {
    return false;
  }
}
