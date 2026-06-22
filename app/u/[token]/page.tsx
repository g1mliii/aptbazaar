import { revalidatePath } from "next/cache";

import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { storefrontUrl } from "@/lib/qr/poster";
import {
  findUnsubscribeTarget,
  unsubscribeByToken
} from "@/lib/subscribers/unsubscribe";

// Phase 6.7a: the human-facing unsubscribe landing page. The token is the bearer credential — no
// seller session — so the work happens through the service-role client inside the unsubscribe
// module. The GET render is READ-ONLY (findUnsubscribeTarget): a mail-security scanner or link
// prefetch that follows the body link must not unsubscribe anyone. The actual unsubscribe only runs
// when the visitor clicks "Unsubscribe", which fires the confirm server action (a POST) — itself
// idempotent. Only the store's display name + slug surface here; never a unit number or other PII.
// An unknown token gets a kit-voice not-found card, never a 500. The one-click List-Unsubscribe POST
// lands at the sibling /api/unsubscribe/[token] route.

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const target = await findUnsubscribeTarget(token);

  async function confirmUnsubscribe() {
    "use server";
    await unsubscribeByToken(token);
    revalidatePath(`/u/${token}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <Card className="w-full text-center">
        {!target.ok ? (
          <>
            <h1 className="font-display text-28 leading-tight text-ink">
              That link doesn&apos;t look right.
            </h1>
            <p className="mt-3 font-sans text-14 text-ink-2">
              This unsubscribe link is expired or already used. If you keep getting
              emails you didn&apos;t ask for, reply to one and let the seller know.
            </p>
          </>
        ) : target.alreadyUnsubscribed ? (
          <>
            <h1 className="font-display text-28 leading-tight text-ink">
              You&apos;re unsubscribed from {target.storeName}&apos;s drops.
            </h1>
            <p className="mt-3 font-sans text-14 text-ink-2">
              You won&apos;t get any more drop emails from them. Your orders aren&apos;t
              affected.
            </p>
            <p className="mt-4 font-sans text-13 text-ink-3">
              Changed your mind?{" "}
              <a
                className="font-semibold text-verdigris underline"
                href={storefrontUrl(target.storeSlug)}
              >
                Re-subscribe
              </a>
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-28 leading-tight text-ink">
              Unsubscribe from {target.storeName}&apos;s drops?
            </h1>
            <p className="mt-3 font-sans text-14 text-ink-2">
              You&apos;ll stop getting drop emails from them. Your orders aren&apos;t
              affected.
            </p>
            <form action={confirmUnsubscribe} className="mt-5">
              <Button type="submit" variant="danger">
                Unsubscribe
              </Button>
            </form>
          </>
        )}
      </Card>
    </main>
  );
}
