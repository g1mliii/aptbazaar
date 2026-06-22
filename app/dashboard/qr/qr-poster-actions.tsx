"use client";

import { Check, Copy, Download, FileText, Printer, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/app/components/ui/button";

// Phase 7.2: the download + share rail next to the poster. Binary formats stream from the authed
// /api/qr route (plain links), so this stays a thin client shell over Print, Copy, and the native
// share sheet. Share links carry a ?src= channel tag so the dashboard can attribute scans.

const DOWNLOADS = [
  { format: "svg", label: "SVG", icon: Download },
  { format: "png-512", label: "PNG 512", icon: Download },
  { format: "png-1024", label: "PNG 1024", icon: Download },
  { format: "pdf-letter", label: "PDF letter", icon: FileText },
  { format: "pdf-a4", label: "PDF A4", icon: FileText }
] as const;

const SHARE_TARGETS = [
  { channel: "instagram", label: "Instagram bio" },
  { channel: "whatsapp", label: "WhatsApp" }
] as const;

export function QrPosterActions({ storefrontUrl }: { storefrontUrl: string }) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  function flashCopied(label: string) {
    setCopiedLabel(label);
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      setCopiedLabel(null);
      timeoutRef.current = null;
    }, 2000);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(storefrontUrl);
      flashCopied("Copy link");
    } catch {
      // Clipboard blocked (insecure context / denied) — the URL is visible on the poster.
    }
  }

  async function share(channel: string, label: string) {
    const url = `${storefrontUrl}?src=${channel}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url, title: "Your Stoop storefront" });
        return;
      } catch {
        // Sheet dismissed or unsupported target — fall back to copying the tagged link.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      flashCopied(label);
    } catch {
      // Nothing more we can do silently; the link is on screen.
    }
  }

  return (
    <div className="space-y-4 print:hidden">
      <div>
        <h2 className="mb-3 text-16 font-semibold text-ink">Download &amp; share</h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => window.print()} size="sm">
            <Printer aria-hidden="true" />
            Print poster
          </Button>
          {DOWNLOADS.map(({ format, label, icon: Icon }) => (
            <Button asChild key={format} size="sm" variant="secondary">
              <a download href={`/api/qr?format=${format}`}>
                <Icon aria-hidden="true" />
                {label}
              </a>
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={copyLink} size="sm" variant="secondary">
          {copiedLabel === "Copy link" ? (
            <Check aria-hidden="true" />
          ) : (
            <Copy aria-hidden="true" />
          )}
          {copiedLabel === "Copy link" ? "Link copied" : "Copy link"}
        </Button>
        {SHARE_TARGETS.map(({ channel, label }) => (
          <Button
            key={channel}
            onClick={() => share(channel, label)}
            size="sm"
            variant="secondary"
          >
            {copiedLabel === label ? (
              <Check aria-hidden="true" />
            ) : (
              <Share2 aria-hidden="true" />
            )}
            {copiedLabel === label ? "Link copied" : label}
          </Button>
        ))}
      </div>

      <p className="text-12 leading-relaxed text-ink-3">
        The QR points at{" "}
        <span className="font-mono text-ink-2">
          {storefrontUrl.replace(/^https?:\/\//, "")}
        </span>
        . Shared links include a <span className="font-mono">?src=</span> tag so you can
        see which channel works best.
      </p>
    </div>
  );
}
