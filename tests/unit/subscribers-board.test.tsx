import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  exportSubscribersCsv: vi.fn(),
  removeSubscriber: vi.fn(),
  sendDrop: vi.fn()
}));

vi.mock("@/lib/actions/subscribers", () => ({
  exportSubscribersCsv: actions.exportSubscribersCsv,
  removeSubscriber: actions.removeSubscriber,
  sendDrop: actions.sendDrop
}));

import {
  SubscribersBoard,
  type SubscriberRow
} from "@/app/dashboard/subscribers/subscribers-board";

const ACTIVE: SubscriberRow = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "priya@example.com",
  consent_email: true,
  verified_at: "2026-03-01T12:00:00.000Z",
  unsubscribed_at: null,
  created_at: "2026-03-01T12:00:00.000Z"
};

const UNSUBSCRIBED: SubscriberRow = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "daniel@example.com",
  consent_email: true,
  verified_at: "2026-02-20T12:00:00.000Z",
  unsubscribed_at: "2026-03-05T12:00:00.000Z",
  created_at: "2026-02-20T12:00:00.000Z"
};

function renderBoard(
  contactAddress: string | null,
  subscribers: SubscriberRow[] = [ACTIVE, UNSUBSCRIBED],
  dailyLimit = 200
) {
  return render(
    <SubscribersBoard
      subscribers={subscribers}
      totalSubscriberCount={subscribers.length}
      activeSubscriberCount={
        subscribers.filter((s) => s.unsubscribed_at === null).length
      }
      contactAddress={contactAddress}
      dailyLimit={dailyLimit}
      remainingToday={dailyLimit}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.exportSubscribersCsv.mockResolvedValue({
    ok: true,
    filename: "subscribers-priyas-kitchen.csv",
    csv: "email\r\npriya@example.com"
  });
});

describe("SubscribersBoard", () => {
  it("renders email-only columns with status stamps — no phone/SMS/name", () => {
    renderBoard("123 Main St");
    expect(screen.getByText("priya@example.com")).toBeInTheDocument();
    expect(screen.getByText("daniel@example.com")).toBeInTheDocument();
    // Status stamps live in each row (the active subscriber's "Active" stamp, distinct from the
    // "Active" KPI label, so scope to the row).
    const activeRow = screen
      .getByText("priya@example.com")
      .closest("div") as HTMLElement;
    expect(within(activeRow).getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Unsubscribed")).toBeInTheDocument();
    // Email-only: the kit's SMS/Phone columns are intentionally absent.
    expect(screen.queryByText("Phone")).not.toBeInTheDocument();
    expect(screen.queryByText("SMS")).not.toBeInTheDocument();
  });

  it("counts only active subscribers for the send target", () => {
    renderBoard("123 Main St");
    fireEvent.click(screen.getByRole("button", { name: "Send a drop" }));
    // One active, one unsubscribed → Send to 1.
    expect(screen.getByRole("button", { name: "Send to 1" })).toBeInTheDocument();
  });

  it("shows the Settings banner and disables Send when no contact address", () => {
    renderBoard(null);
    fireEvent.click(screen.getByRole("button", { name: "Send a drop" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "Add your mailing address in Settings before sending drops."
      )
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Send to 1" })).toBeDisabled();
    expect(actions.sendDrop).not.toHaveBeenCalled();
  });

  it("does not open the composer when nobody is active", () => {
    renderBoard("123 Main St", [UNSUBSCRIBED]);
    expect(screen.getByRole("button", { name: "Send a drop" })).toBeDisabled();
  });

  it("uses the configured daily limit in the composer copy", () => {
    renderBoard("123 Main St", [ACTIVE], 75);
    fireEvent.click(screen.getByRole("button", { name: "Send a drop" }));
    expect(screen.getByText("75")).toHaveClass("font-mono");
  });

  it("optimistically removes a subscriber after confirmation", async () => {
    actions.removeSubscriber.mockResolvedValue({ ok: true });
    renderBoard("123 Main St");

    fireEvent.click(screen.getByRole("button", { name: "Remove priya@example.com" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(screen.queryByText("priya@example.com")).not.toBeInTheDocument()
    );
    expect(actions.removeSubscriber).toHaveBeenCalledWith(ACTIVE.id);
  });

  it("exports through the authenticated full-roster action", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:subscribers");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);

    renderBoard("123 Main St");
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(actions.exportSubscribersCsv).toHaveBeenCalledTimes(1));
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:subscribers");
  });
});
