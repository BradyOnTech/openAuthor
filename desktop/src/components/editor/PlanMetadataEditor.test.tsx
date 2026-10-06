// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { updatePlanSceneMetadata } from "../../api";
import { PlanMetadataEditor } from "./PlanMetadataEditor";
vi.mock("../../api", () => ({ updatePlanSceneMetadata: vi.fn(), getManuscriptPlan: vi.fn() }));
const metadata = { timeline_position: "Day 1", labels: ["opening"] };
const props = { project: "book", scope: "main", sceneId: "scene-1", title: "Dawn", metadata };
beforeEach(() => { localStorage.clear(); vi.resetAllMocks(); });
afterEach(cleanup);
it("recovers story time and labels with the baseline they were edited from", async () => {
  const first = render(<PlanMetadataEditor {...props} />);
  fireEvent.click(screen.getByText("Saved scene brief, story time & labels"));
  fireEvent.change(screen.getByRole("textbox", { name: "Story time for Dawn" }), { target: { value: "Day 2" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Labels for Dawn" }), { target: { value: "" } });
  first.unmount(); render(<PlanMetadataEditor {...props} />);
  fireEvent.click(screen.getByText("Saved scene brief, story time & labels"));
  expect((screen.getByRole("textbox", { name: "Story time for Dawn" }) as HTMLInputElement).value).toBe("Day 2");
  vi.mocked(updatePlanSceneMetadata).mockResolvedValue({ timeline_position: "Day 2", labels: [] });
  fireEvent.click(screen.getByRole("button", { name: "Save planning details" }));
  await waitFor(() => expect(updatePlanSceneMetadata).toHaveBeenCalledWith("book", "scene-1", { timelinePosition: "Day 2", labels: [], writingBrief: {} }, { workspace: "main", value: metadata }));
  await screen.findByText(/Planning details saved/);
});
