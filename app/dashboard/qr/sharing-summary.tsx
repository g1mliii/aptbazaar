import { QrCode } from "lucide-react";

import { EmptyState } from "@/app/components/ui/empty-state";
import { EMPTY_STATES } from "@/lib/copy/empty-states";

// Phase 7.5: the live sharing summary that replaces the "No scans yet" placeholder once a QR is in
// the world. Pure presentational so it's straightforward to component-test across the zero / one /
// multi-channel states. Every count is mono + tabular (hard invariant 12).

export interface ScanChannel {
  src: string;
  count: number;
}

// Friendly labels for the channels we tag ourselves; anything else is title-cased as-is.
const CHANNEL_LABELS: Record<string, string> = {
  direct: "Direct",
  instagram: "Instagram bio",
  whatsapp: "WhatsApp",
  poster: "Printed poster"
};

function channelLabel(src: string): string {
  return CHANNEL_LABELS[src] ?? src.charAt(0).toUpperCase() + src.slice(1);
}

export function SharingSummary({ channels }: { channels: ScanChannel[] }) {
  const total = channels.reduce((sum, channel) => sum + channel.count, 0);

  if (total === 0) {
    return (
      <div>
        <h2 className="mb-3 text-16 font-semibold text-ink">Where scans came from</h2>
        <EmptyState
          icon={QrCode}
          title={EMPTY_STATES.scans.title}
          body={EMPTY_STATES.scans.body}
        />
      </div>
    );
  }

  const sorted: ScanChannel[] = [...channels].sort((a, b) => b.count - a.count);
  const top = sorted[0];

  return (
    <div>
      <h2 className="mb-3 text-16 font-semibold text-ink">Where scans came from</h2>
      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-14 text-ink-2">Total scans</span>
          <span className="font-mono text-20 tabular-nums text-ink">{total}</span>
        </div>

        <ul className="mt-4 space-y-2 border-t border-line pt-4">
          {sorted.map((channel) => (
            <li
              key={channel.src}
              className="flex items-baseline justify-between text-14"
            >
              <span className="text-ink-2">{channelLabel(channel.src)}</span>
              <span className="font-mono tabular-nums text-ink">{channel.count}</span>
            </li>
          ))}
        </ul>

        {top ? (
          <p className="mt-4 border-t border-line pt-4 text-13 text-ink-3">
            Most scans come from{" "}
            <span className="font-semibold text-ink-2">{channelLabel(top.src)}</span>.
          </p>
        ) : null}
      </div>
    </div>
  );
}
