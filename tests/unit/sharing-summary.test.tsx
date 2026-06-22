import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SharingSummary } from "@/app/dashboard/qr/sharing-summary";
import { EMPTY_STATES } from "@/lib/copy/empty-states";

describe("SharingSummary", () => {
  it("shows the empty state when there are no scans", () => {
    render(<SharingSummary channels={[]} />);
    expect(screen.getByText(EMPTY_STATES.scans.title)).toBeInTheDocument();
  });

  it("renders a single channel's total", () => {
    render(<SharingSummary channels={[{ src: "direct", count: 7 }]} />);
    expect(screen.getByText("Total scans")).toBeInTheDocument();
    // "Direct" shows in the row and in the top-channel sentence.
    expect(screen.getAllByText("Direct").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("7").length).toBeGreaterThanOrEqual(1);
  });

  it("sums multiple channels and names the top one", () => {
    render(
      <SharingSummary
        channels={[
          { src: "instagram", count: 12 },
          { src: "whatsapp", count: 5 },
          { src: "direct", count: 30 }
        ]}
      />
    );
    expect(screen.getByText("47")).toBeInTheDocument(); // 12 + 5 + 30
    const topLine = screen.getByText(/Most scans come from/);
    expect(topLine).toHaveTextContent("Direct");
  });
});
