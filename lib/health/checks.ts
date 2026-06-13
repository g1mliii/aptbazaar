import { optionalEnv } from "@/lib/env";
import { isCloudflareEmailConfigured } from "@/lib/email/cloudflare-email";
import { version } from "@/lib/version";

type CheckResult = {
  configured: boolean;
  latencyMs?: number;
  message: string;
  ok: boolean | null;
};

type HealthPayload = {
  checks: {
    email: CheckResult;
    supabase: CheckResult;
  };
  status: "ok" | "degraded";
  timestamp: string;
  version: typeof version;
};

const deepCheckTimeoutMs = 3_000;

async function measure<T>(fn: () => Promise<T>) {
  const start = Date.now();
  const result = await fn();
  return {
    latencyMs: Date.now() - start,
    result
  };
}

async function checkSupabase(deep: boolean): Promise<CheckResult> {
  const url = optionalEnv("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = optionalEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  if (!url || !publishableKey) {
    return {
      configured: false,
      message: "Supabase is not configured.",
      ok: null
    };
  }

  if (!deep) {
    return {
      configured: true,
      message: "Supabase configuration is present.",
      ok: null
    };
  }

  try {
    const { latencyMs, result } = await measure(() =>
      fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, {
        headers: {
          apikey: publishableKey
        },
        cache: "no-store",
        signal: AbortSignal.timeout(deepCheckTimeoutMs)
      })
    );

    return {
      configured: true,
      latencyMs,
      message: result.ok
        ? "Supabase responded."
        : "Supabase did not respond cleanly.",
      ok: result.ok
    };
  } catch {
    return {
      configured: true,
      message: "Supabase ping failed.",
      ok: false
    };
  }
}

function checkCloudflareEmail(): CheckResult {
  const fromEmail = optionalEnv("CLOUDFLARE_EMAIL_FROM");

  if (!fromEmail) {
    return {
      configured: false,
      message: "Cloudflare Email sender is not configured.",
      ok: null
    };
  }

  if (isCloudflareEmailConfigured()) {
    return {
      configured: true,
      message: "Cloudflare Email binding is present.",
      ok: null
    };
  }

  return {
    configured: false,
    message: "Cloudflare Email binding is not available.",
    ok: null
  };
}

export async function getHealthPayload(deep: boolean): Promise<HealthPayload> {
  const supabase = await checkSupabase(deep);
  const email = checkCloudflareEmail();
  const failed = [supabase, email].some((check) => check.ok === false);

  return {
    checks: {
      email,
      supabase
    },
    status: failed ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    version
  };
}
