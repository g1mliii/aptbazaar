import { describe, expect, it } from "vitest";

import { orderRefFrom, pickupOptionsFor } from "@/lib/orders/pickup";

describe("pickupOptionsFor", () => {
  it("offers the scheduled window plus a message fallback", () => {
    const options = pickupOptionsFor({
      pickup_method: "scheduled_window",
      pickup_window_label: "Sat 9am–1pm",
      pickup_public_note: null
    });
    expect(options[0]).toBe("Sat 9am–1pm");
    expect(options).toContain("Message me — we'll coordinate");
  });

  it("uses the public note for lobby pickup, falling back to a default label", () => {
    expect(
      pickupOptionsFor({
        pickup_method: "lobby_pickup",
        pickup_window_label: null,
        pickup_public_note: "Maple Towers lobby"
      })[0]
    ).toBe("Maple Towers lobby");
    expect(
      pickupOptionsFor({
        pickup_method: "lobby_pickup",
        pickup_window_label: null,
        pickup_public_note: null
      })[0]
    ).toBe("Lobby / front desk pickup");
  });

  it("offers only the message fallback for message-after-order", () => {
    expect(
      pickupOptionsFor({
        pickup_method: "message_after_order",
        pickup_window_label: null,
        pickup_public_note: null
      })
    ).toEqual(["Message me — we'll coordinate"]);
  });

  it("never duplicates an option", () => {
    const options = pickupOptionsFor({
      pickup_method: "scheduled_window",
      pickup_window_label: "Message me — we'll coordinate",
      pickup_public_note: null
    });
    expect(new Set(options).size).toBe(options.length);
  });
});

describe("orderRefFrom", () => {
  it("is a short uppercase reference, never the raw uuid", () => {
    const id = "abcdef12-3456-7890-abcd-ef1234567890";
    const ref = orderRefFrom(id);
    expect(ref).toBe("#ABCDEF");
    expect(ref).not.toContain("-");
    expect(ref.length).toBe(7);
  });
});
