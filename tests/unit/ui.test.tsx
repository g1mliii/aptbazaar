import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Logo } from "@/app/components/brand/logo";
import { Button } from "@/app/components/ui/button";
import { Stamp } from "@/app/components/ui/stamp";

describe("Stoop primitives", () => {
  it("renders the brand logo with accessible text", () => {
    render(<Logo variant="mark" />);

    expect(screen.getByAltText("Stoop mark")).toBeInTheDocument();
  });

  it("applies kit button variants", () => {
    render(<Button variant="primary">Open your stoop</Button>);

    expect(screen.getByRole("button", { name: "Open your stoop" })).toHaveClass(
      "bg-verdigris"
    );
  });

  it("forwards props through asChild buttons", () => {
    const onClick = vi.fn();

    render(
      <Button
        asChild
        aria-label="Open health"
        onClick={(event) => {
          event.preventDefault();
          onClick();
        }}
      >
        <a href="/api/health">Health</a>
      </Button>
    );

    const link = screen.getByRole("link", { name: "Open health" });

    expect(link).toHaveAttribute("href", "/api/health");
    expect(link).toHaveClass("bg-verdigris");

    fireEvent.click(link);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders status as a rubber stamp", () => {
    render(<Stamp status="ready">Ready</Stamp>);

    expect(screen.getByText("Ready")).toHaveClass("border-current");
  });
});
