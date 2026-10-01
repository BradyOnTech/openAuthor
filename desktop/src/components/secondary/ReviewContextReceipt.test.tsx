// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewContextReceipt } from "./ReviewContextReceipt";

afterEach(cleanup);

describe("review context receipt", () => {
  it("shows the supplied chapter, canon count, experiment and evidence limitations", () => {
    render(<ReviewContextReceipt context={{ review: {
      chapter_titles: ["The Choice"], canon_fact_ids: ["fact-ivo"], storyline_name: "Mara stays",
      scene_titles: ["The Brake"], nearby_scene_titles: ["The Spare Key"], scope: "scene",
      selected_text_included: true, retrieval_result_count: 2,
      warnings: ["Accepted fact fact-ivo: evidence is missing."], omitted_item_count: 2,
    }, context_pack: { budget: { used: 5300, ceiling: 16000, is_estimate: true } } }} />);
    expect(screen.getByText("Context used · 1 evidence warning")).toBeTruthy();
    expect(screen.getByText("Chapters: The Choice")).toBeTruthy();
    expect(screen.getByText("Scope: Scene")).toBeTruthy();
    expect(screen.getByText("Scenes: The Brake")).toBeTruthy();
    expect(screen.getByText("Nearby scenes: The Spare Key")).toBeTruthy();
    expect(screen.getByText("Selected passage included.")).toBeTruthy();
    expect(screen.getByText("Retrieved evidence: 2 result(s).")).toBeTruthy();
    expect(screen.getByText("1 accepted canon fact supplied.")).toBeTruthy();
    expect(screen.getByText("Storyline: Mara stays")).toBeTruthy();
    expect(screen.getByText(/evidence is missing/)).toBeTruthy();
    expect(screen.getByText(/2 optional context item/)).toBeTruthy();
    expect(screen.getByText(/Estimated request: 5,300 \/ 16,000 tokens, including response reserve/)).toBeTruthy();
    expect(screen.getByText(/not a guarantee of a complete review/)).toBeTruthy();
  });

  it("does not invent a receipt for older messages and handles empty or malformed optional fields", () => {
    const view = render(<ReviewContextReceipt context={{}} />);
    expect(view.container.textContent).toBe("");
    view.rerender(<ReviewContextReceipt context={{ review: { chapter_titles: "bad", warnings: [null] } }} />);
    expect(screen.getByText("0 accepted canon facts supplied.")).toBeTruthy();
    expect(screen.queryByText(/evidence warning/)).toBeNull();
  });
});
