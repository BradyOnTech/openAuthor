// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelArea } from "./PanelArea";

const harness = vi.hoisted(() => ({
  panelTab: "mobile" as "runs" | "merge" | "budget" | "mobile",
  setPanelTab: vi.fn(),
}));

vi.mock("../../contexts/UIContext", () => ({
  useUI: () => ({
    panelOpen: true,
    panelTab: harness.panelTab,
    setPanelTab: harness.setPanelTab,
  }),
}));
vi.mock("./RunsPanel", () => ({ RunsPanel: () => <div>Runs content</div> }));
vi.mock("./MergePanel", () => ({ MergePanel: () => <div>Merge content</div> }));
vi.mock("./BudgetPanel", () => ({ BudgetPanel: () => <div>Budget content</div> }));
vi.mock("./MobileInboxPanel", () => ({
  MobileInboxPanel: () => <div>Mobile inbox content</div>,
}));

describe("PanelArea mobile tab", () => {
  afterEach(() => {
    cleanup();
    harness.setPanelTab.mockReset();
  });

  it("renders the read-only mobile inbox and exposes its tab", () => {
    render(<PanelArea />);

    expect(screen.getByText("Mobile inbox content")).toBeTruthy();
    fireEvent.click(screen.getByText("Mobile"));
    expect(harness.setPanelTab).toHaveBeenCalledWith("mobile");
    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
  });
});
