import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useCart } from "@/app/components/storefront/use-cart";
import type { StorefrontProduct } from "@/app/components/storefront/types";

const products: StorefrontProduct[] = [
  {
    id: "p1",
    name: "Cookies",
    description: null,
    price_cents: 600,
    image_url: null,
    qty_available: 3,
    allergens: []
  },
  {
    id: "p2",
    name: "Bread",
    description: null,
    price_cents: 800,
    image_url: null,
    qty_available: null,
    allergens: []
  }
];

afterEach(() => {
  sessionStorage.clear();
});

describe("useCart", () => {
  it("adds, increments, and computes the subtotal", () => {
    const { result } = renderHook(() => useCart("shop", products));
    act(() => result.current.add("p1"));
    act(() => result.current.add("p1"));
    act(() => result.current.add("p2"));
    expect(result.current.qtyOf("p1")).toBe(2);
    expect(result.current.itemCount).toBe(3);
    expect(result.current.subtotalCents).toBe(600 * 2 + 800);
  });

  it("removes a line when its quantity hits zero", () => {
    const { result } = renderHook(() => useCart("shop", products));
    act(() => result.current.add("p1"));
    act(() => result.current.dec("p1"));
    expect(result.current.qtyOf("p1")).toBe(0);
    expect(result.current.lines).toHaveLength(0);
  });

  it("caps quantity at a finite qty_available", () => {
    const { result } = renderHook(() => useCart("shop", products));
    act(() => {
      result.current.add("p1");
      result.current.add("p1");
      result.current.add("p1");
      result.current.add("p1");
    });
    expect(result.current.qtyOf("p1")).toBe(3);
  });

  it("does not cap an unlimited (null qty_available) product", () => {
    const { result } = renderHook(() => useCart("shop", products));
    act(() => {
      for (let i = 0; i < 10; i += 1) result.current.add("p2");
    });
    expect(result.current.qtyOf("p2")).toBe(10);
  });

  it("clears the cart", () => {
    const { result } = renderHook(() => useCart("shop", products));
    act(() => result.current.add("p1"));
    act(() => result.current.clear());
    expect(result.current.itemCount).toBe(0);
  });

  it("uses a versioned sessionStorage key", async () => {
    sessionStorage.setItem("stoop.cart.shop", JSON.stringify({ p1: 3 }));
    sessionStorage.setItem("stoop.cart.v1.shop", JSON.stringify({ p1: 2 }));

    const { result } = renderHook(() => useCart("shop", products));

    await waitFor(() => expect(result.current.qtyOf("p1")).toBe(2));
    act(() => result.current.add("p2"));

    await waitFor(() =>
      expect(sessionStorage.getItem("stoop.cart.v1.shop")).toContain('"p2":1')
    );
    expect(sessionStorage.getItem("stoop.cart.shop")).toBe(JSON.stringify({ p1: 3 }));
  });
});
