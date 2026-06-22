import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The seal fires the server action on mount; mock it so the component imports + runs in jsdom
// without pulling in the supabase server client.
const markFirstScanSeen = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/actions/nudge", () => ({ markFirstScanSeen }));

const { FirstScanSeal } = await import("@/app/dashboard/orders/first-scan-seal");

const STORE_ID = "11111111-1111-4111-8111-111111111111";

describe("FirstScanSeal", () => {
  it("celebrates the first scan and acknowledges the displayed store exactly once", async () => {
    render(<FirstScanSeal storeId={STORE_ID} />);
    expect(screen.getByText("Your first scan!")).toBeInTheDocument();
    await waitFor(() => expect(markFirstScanSeen).toHaveBeenCalledTimes(1));
    expect(markFirstScanSeen).toHaveBeenCalledWith(STORE_ID);
  });
});
