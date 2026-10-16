import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge, ToneBadge } from "@/components/common/StatusBadge";

describe("StatusBadge", () => {
  it("renders the humanised label with the success tone", () => {
    render(<StatusBadge status="PAID" />);
    const badge = screen.getByText("Paid");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("bg-success/15");
  });

  it("renders the destructive tone for a danger status", () => {
    render(<StatusBadge status="OVERDUE" />);
    const badge = screen.getByText("Overdue");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("bg-destructive/15");
  });

  it("renders the muted tone for a muted status", () => {
    render(<StatusBadge status="DRAFT" />);
    expect(screen.getByText("Draft").className).toContain("bg-muted/40");
  });

  it("prefers an explicit label over the derived one", () => {
    render(<StatusBadge status="PAID" label="Settled" />);
    expect(screen.getByText("Settled")).toBeInTheDocument();
  });

  it("renders a dash when status is missing", () => {
    render(<StatusBadge status={null} />);
    expect(screen.getByText("-")).toBeInTheDocument();
  });
});

describe("ToneBadge", () => {
  it("renders children with the mapped variant", () => {
    render(<ToneBadge tone="warning">Look</ToneBadge>);
    expect(screen.getByText("Look").className).toContain("bg-warning/15");
  });
});
