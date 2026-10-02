// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CanonDiagnostic, SceneSummary } from "../../types";
import { ContinuityReview } from "./ContinuityReview";

afterEach(cleanup);
const scenes: SceneSummary[] = ["The Harbor", "The Gate"].map((title, index) => ({ id: `s${index + 1}`, title, summary: "", pov: "Mara", status: "draft", created_at: "today", updated_at: "today", path: "scene.md" }));
const finding: CanonDiagnostic = {
  id: "d1", code: "conflicting_facts", severity: "error", title: "Conflicting Canon Facts", message: "The gate has two colors in the same interval.", fact_ids: ["f1", "f2"], scene_ids: ["s1", "s2"],
  evidence: [{ scene_id: "s1", excerpt: "The gate was blue.", start: 0, end: 18 }, { scene_id: "s2", excerpt: "The gate was red.", start: 0, end: 17 }],
};

it("shows exact recorded passages and requires a scene choice before preparing a multi-scene finding", () => {
  const open = vi.fn(), revise = vi.fn(), review = vi.fn();
  render(<ContinuityReview diagnostics={[finding]} scenes={scenes} busy={false} onOpenScene={open} onRevise={revise} onReview={review} />);
  fireEvent.click(screen.getByText("Review evidence (2)"));
  expect(screen.getByText("The gate was blue.")).toBeTruthy();
  expect(screen.getByText("The gate was red.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open scene: The Gate" }));
  expect(open).toHaveBeenCalledWith(scenes[1]);
  const plan = screen.getByRole("button", { name: "Plan a revision" });
  expect((plan as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Scene to revise"), { target: { value: "s2" } });
  fireEvent.click(plan);
  expect(revise).toHaveBeenCalledWith(finding, "s2", expect.stringContaining("The Gate"));
  expect(revise.mock.calls[0][2]).toContain("only if the finding is valid");
  expect(review).not.toHaveBeenCalled();
});

it("keeps deferred findings actionable and lets the author revisit reviewed decisions with a reason", () => {
  const review = vi.fn();
  const reviewed = { ...finding, disposition: { disposition: "intentional" as const, notes: "Unreliable narrator." } };
  const deferred = { ...finding, id: "d2", title: "Deferred finding", disposition: { disposition: "deferred" as const, notes: "Check chapter two." } };
  render(<ContinuityReview diagnostics={[reviewed, deferred]} scenes={scenes} busy={false} onOpenScene={vi.fn()} onRevise={vi.fn()} onReview={review} />);
  expect(screen.getByRole("article", { name: "Deferred finding" })).toBeTruthy();
  expect(screen.queryByRole("article", { name: finding.title })).toBeNull();
  fireEvent.change(screen.getByLabelText("Filter continuity findings"), { target: { value: "reviewed" } });
  const card = within(screen.getByRole("article", { name: finding.title }));
  fireEvent.click(card.getByText("Update review decision"));
  expect((card.getByLabelText("Review notes") as HTMLTextAreaElement).value).toBe("Unreliable narrator.");
  fireEvent.change(card.getByLabelText("Decision"), { target: { value: "deferred" } });
  fireEvent.change(card.getByLabelText("Review notes"), { target: { value: "Recheck the narrator's account." } });
  fireEvent.click(card.getByRole("button", { name: "Save review decision" }));
  expect(review).toHaveBeenCalledWith("d1", "deferred", "Recheck the narrator's account.");
});

it("does not retarget missing scenes or treat recorded evidence as current verification", () => {
  render(<ContinuityReview diagnostics={[finding]} scenes={[]} busy={false} onOpenScene={vi.fn()} onRevise={vi.fn()} onReview={vi.fn()} />);
  fireEvent.click(screen.getByText("Review evidence (2)"));
  expect(screen.getByText("Scene unavailable (s1)")).toBeTruthy();
  expect(screen.getByText(/These are recorded passages/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Plan a revision" }) as HTMLButtonElement).disabled).toBe(true);
});

it("moves through findings with the keyboard and keeps unfinished review notes", () => {
  const diagnostics = [finding, { ...finding, id: "d2", title: "Character knowledge conflict" }, { ...finding, id: "d3", title: "Timeline mismatch" }];
  const review = vi.fn();
  render(<ContinuityReview diagnostics={diagnostics} scenes={scenes} busy={false} onOpenScene={vi.fn()} onRevise={vi.fn()} onReview={review} />);
  const list = within(screen.getByRole("navigation", { name: "Findings to review" }));
  const first = list.getByRole("button", { name: /Conflicting Canon Facts/ });
  first.focus();
  const article = within(screen.getByRole("article", { name: finding.title }));
  fireEvent.click(article.getByText("Record review decision"));
  fireEvent.change(article.getByLabelText("Review notes"), { target: { value: "Confirm the narrator knows this." } });
  fireEvent.keyDown(first, { key: "ArrowDown" });
  const second = list.getByRole("button", { name: /Character knowledge conflict/ });
  expect(document.activeElement).toBe(second);
  expect(second.getAttribute("aria-pressed")).toBe("true");
  expect(first.tabIndex).toBe(-1);
  expect(screen.getByRole("article", { name: "Character knowledge conflict" })).toBeTruthy();
  fireEvent.keyDown(second, { key: "End" });
  const last = list.getByRole("button", { name: /Timeline mismatch/ });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "Home" });
  expect(document.activeElement).toBe(first);
  expect((article.getByLabelText("Review notes") as HTMLTextAreaElement).value).toBe("Confirm the narrator knows this.");
  fireEvent.keyDown(article.getByLabelText("Review notes"), { key: "ArrowDown" });
  expect(first.getAttribute("aria-pressed")).toBe("true");
  expect(review).not.toHaveBeenCalled();
});
