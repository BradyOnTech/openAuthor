// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DraftWordTarget } from "./components/editor/DraftWordTarget";

afterEach(cleanup);

it("exposes an overshoot even when no model review receipt exists", () => {
  const { rerender } = render(<DraftWordTarget body={Array(859).fill("word").join(" ")} target={[650, 850]} />);
  expect(screen.getByRole("status").textContent).toContain("859 words · target 650–850 · 9 above target");
  rerender(<DraftWordTarget body={Array(850).fill("word").join("\n")} target={[650, 850]} />);
  expect(screen.getByRole("status").textContent).toContain("850 words · target 650–850 · within target");
  expect(screen.queryByText(/Adjust the draft/)).toBeNull();
});

it("reports empty drafts below their target without treating whitespace as words", () => {
  render(<DraftWordTarget body={" \n\t "} target={[650, 850]} />);
  expect(screen.getByRole("status").textContent).toContain("0 words · target 650–850 · 650 below target");
});
