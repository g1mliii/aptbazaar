import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  updateOrderStatus: vi.fn(),
  cancelOrder: vi.fn(),
  markPaid: vi.fn(),
  updateOrderNotes: vi.fn(),
  createDashboardLoginLink: vi.fn()
}));

vi.mock("@/lib/actions/orders", () => ({
  updateOrderStatus: actions.updateOrderStatus,
  cancelOrder: actions.cancelOrder,
  markPaid: actions.markPaid,
  updateOrderNotes: actions.updateOrderNotes
}));

vi.mock("@/lib/actions/stripe-connect", () => ({
  createDashboardLoginLink: actions.createDashboardLoginLink
}));

import { OrdersBoard, type BoardOrder } from "@/app/dashboard/orders/orders-board";

const NEW_ORDER: BoardOrder = {
  id: "11111111-1111-4111-8111-111111111111",
  customer_name: "Sam",
  customer_email: "sam@example.com",
  customer_phone_e164: null,
  total_cents: 1200,
  order_status: "new",
  payment_status: "pay_at_pickup",
  payment_mode: "pay_at_pickup",
  pickup_window: "Sat 9am",
  pickup_time: null,
  notes: null,
  notes_seller: null,
  notes_shared: null,
  created_at: new Date().toISOString(),
  order_items: [
    { name_at_purchase: "Cookies", quantity: 2, price_cents_at_purchase: 600 }
  ]
};

const READY_ORDER: BoardOrder = {
  ...NEW_ORDER,
  id: "22222222-2222-4222-8222-222222222222",
  customer_name: "Jo",
  order_status: "ready",
  order_items: [
    { name_at_purchase: "Bread", quantity: 1, price_cents_at_purchase: 800 }
  ]
};

const CANCELLED_ORDER: BoardOrder = {
  ...NEW_ORDER,
  id: "33333333-3333-4333-8333-333333333333",
  customer_name: "Mina",
  order_status: "cancelled"
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OrdersBoard", () => {
  it("derives filter chip counts from the orders", () => {
    render(<OrdersBoard orders={[NEW_ORDER, READY_ORDER, CANCELLED_ORDER]} />);
    expect(screen.getByRole("button", { name: /^All/ })).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /^New/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /^Ready/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /^Cancelled/ })).toHaveTextContent("1");
  });

  it("optimistically advances then rolls back on failure with a danger toast", async () => {
    actions.updateOrderStatus.mockResolvedValue({
      ok: false,
      error: "That status change isn't allowed."
    });
    render(<OrdersBoard orders={[NEW_ORDER]} />);

    // The first order is selected by default; its detail shows the advance button.
    fireEvent.click(screen.getByRole("button", { name: "Accept order" }));

    await waitFor(() =>
      expect(screen.getByText("That status change isn't allowed.")).toBeInTheDocument()
    );
    // Rolled back: the primary action is once again "Accept order" (status reverted to new).
    expect(screen.getByRole("button", { name: "Accept order" })).toBeInTheDocument();
    expect(actions.updateOrderStatus).toHaveBeenCalledWith({
      orderId: NEW_ORDER.id,
      to: "accepted"
    });
  });

  it("gates the cancel confirmation on typing CANCEL", () => {
    render(<OrdersBoard orders={[NEW_ORDER]} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));

    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Cancel order" });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByPlaceholderText("CANCEL"), {
      target: { value: "CANCEL" }
    });
    expect(confirm).toBeEnabled();
  });

  it("autosaves a changed note on blur and shows the Saved toast", async () => {
    actions.updateOrderNotes.mockResolvedValue({ ok: true });
    render(<OrdersBoard orders={[NEW_ORDER]} />);

    const textarea = screen.getByPlaceholderText("Shows on their tracking page.");
    fireEvent.change(textarea, { target: { value: "Out back, ring the bell." } });
    fireEvent.blur(textarea);

    await waitFor(() => expect(screen.getByText("Saved.")).toBeInTheDocument());
    expect(actions.updateOrderNotes).toHaveBeenCalledWith({
      orderId: NEW_ORDER.id,
      notesShared: "Out back, ring the bell."
    });
  });
});
