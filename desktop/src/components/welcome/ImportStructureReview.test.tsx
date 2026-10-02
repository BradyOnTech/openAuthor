// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { ImportCorrections, ManuscriptImportPreview } from "../../api";
import { ImportStructureReview } from "./ImportStructureReview";

afterEach(cleanup);

function preview(): ManuscriptImportPreview {
  return {
    source: "/synthetic/book", strategy: "auto", scene_count: 1, word_count: 4,
    act_count: 2, chapter_count: 2, fingerprint: "reviewed-outline", warnings: [],
    sections: [
      { id: "section-0001", title: "Future", role: "act", level: 1, word_count: 0, excerpt: "" },
      { id: "section-0002", title: "Journey", role: "act", level: 1, word_count: 0, excerpt: "" },
      { id: "section-0003", title: "Unwritten", role: "chapter", level: 2, word_count: 0, excerpt: "" },
      { id: "section-0004", title: "Arrival", role: "chapter", level: 2, word_count: 0, excerpt: "" },
    ],
    outline: [
      { title: "Future", chapters: [] },
      { title: "Journey", chapters: [{ title: "Unwritten", scene_positions: [] }, { title: "Arrival", scene_positions: [1] }] },
    ],
    scenes: [{ position: 1, title: "The gate", source_path: "/synthetic/book/scene.md", source_format: "markdown", word_count: 4, excerpt: "Mara opens the gate." }],
  };
}

describe("import outline review", () => {
  it("shows retained empty parts and chapters in their resulting reading order", async () => {
    render(<ImportStructureReview preview={preview()} corrections={{}} dirty={false} onChange={() => undefined} />);
    expect(screen.getByRole("status").textContent).toContain("1 scenes · 4 words · 2 chapters · 2 parts");
    await userEvent.click(screen.getByText("Resulting reading order"));
    const order = screen.getByText("Resulting reading order").parentElement!;
    expect(order.textContent).toBe("Resulting reading orderFuture · Empty partJourneyUnwritten · Empty chapterArrivalThe gate (4 words)");
    expect(within(order).getAllByRole("listitem")).toHaveLength(5);
  });

  it("keeps boundary corrections editable and asks for a refreshed preview", async () => {
    const changes: Array<[string, ImportCorrections[string]]> = [];
    render(<ImportStructureReview preview={preview()} corrections={{ "section-0003": { title: "Planned" } }} dirty onChange={(id, change) => changes.push([id, change])} />);
    expect((screen.getByRole("textbox", { name: "Title for section 3" }) as HTMLInputElement).value).toBe("Planned");
    expect(screen.getByRole("status").textContent).toContain("Update Preview");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role for section 3" }), "text");
    expect(changes).toEqual([["section-0003", { role: "text" }]]);
  });

  it("keeps reading previews from older core responses usable", () => {
    const older = preview();
    delete older.outline;
    delete older.act_count;
    render(<ImportStructureReview preview={older} corrections={{}} dirty={false} onChange={() => undefined} />);
    expect(screen.getByText("The gate (4 words)")).toBeTruthy();
  });
});
