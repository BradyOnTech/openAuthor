import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { desktopBook } from "../support/desktopBook.ts";

test("desktop records a private golden loop, pauses collection and keeps saved signals content-free", { tags: ["desktop", "privacy", "product-signals"], timeout: 150_000 }, async ({ app, browser, screen }) => {
  const book = await desktopBook(browser);
  const projectName = "PRIVATE-PROJECT-NAME-389";
  const pausedTitle = "PRIVATE-PAUSED-SCENE-389";
  const sceneTitle = "PRIVATE-SCENE-NAME-389";
  const original = "Mara unrolled the PRIVATE-PROSE-ONLY-389 map beside the lamp. She locked the door and watched it move.\n\nAt midnight, the line reached her own door.";
  const instruction = "PRIVATE-PROMPT-ONLY-389: Make the final paragraph more ominous while preserving every name, fact and event.";
  const eventsPath = join(book.projectRoot, ".openauthor", "product_events.jsonl");
  try {
    await app.open("/");
    await screen.getByRole("button", "New Project").tap();
    await screen.getByRole("textbox", "Novel title").fill(projectName);
    await screen.getByRole("textbox", "Project folder").fill(book.projectRoot);
    await screen.getByRole("button", "Create novel").tap();
    await expect(screen.getByRole("button", "Add Scene")).toBeVisible();
    await screen.getByRole("button", "Hide first-run guide").tap();
    await screen.getByRole("button", /^Settings \(/).tap();
    await expect(screen.getByRole("heading", "Private Product Dashboard")).toBeVisible();
    await expect(screen.getByText("In progress", { exact: true })).toBeVisible();
    for (const label of ["scene created", "change reviewed", "change applied", "change undone"]) {
      await expect(screen.getByText(`○ ${label}`, { exact: true })).toBeVisible();
    }
    const initialLog = await readFile(eventsPath, "utf8");
    expect((await book.json(["metrics", "dashboard"])).event_count).toBe(1);

    await screen.getByRole("button", "Pause on-device signals").tap();
    await expect(screen.getByRole("button", "Enable on-device signals")).toBeVisible();
    await browser.reload();
    await expect(screen.getByRole("button", "Enable on-device signals")).toBeVisible();
    expect((await book.json(["metrics", "settings"])).local_signals_enabled).toBe(false);
    await screen.getByRole("button", /^Manuscript \(/).tap();
    await screen.getByPlaceholder("New scene title...").fill(pausedTitle);
    await screen.getByRole("button", "Add Scene").tap();
    await expect(screen.getByRole("textbox", "Scene prose")).toBeVisible();
    expect((await book.json(["scene", "list"])).map((row: { title: string }) => row.title)).toEqual([pausedTitle]);
    expect(await readFile(eventsPath, "utf8")).toBe(initialLog);
    await screen.getByRole("button", /^Settings \(/).tap();
    await browser.reload();
    await expect(screen.getByText("○ scene created", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Enable on-device signals").tap();
    await expect(screen.getByRole("button", "Pause on-device signals")).toBeVisible();

    await screen.getByRole("button", /^Manuscript \(/).tap();
    await screen.getByPlaceholder("New scene title...").fill(sceneTitle);
    await screen.getByRole("button", "Add Scene").tap();
    await expect(screen.getByRole("tab", sceneTitle)).toHaveAttribute("aria-selected", "true");
    const prose = screen.getByRole("textbox", "Scene prose");
    await expect(prose).toHaveValue("");
    await prose.fill(original);
    await prose.press("Control+s");
    await expect(screen.getByText("Saved", { exact: true })).toBeVisible();
    await screen.getByRole("button", /^Changes \(/).tap();
    await screen.getByRole("button", "+ AI").tap();
    await screen.getByRole("combobox", "Scene").selectOption({ value: "scene-0002" });
    await screen.getByRole("textbox", "What should change?").fill(instruction);
    await screen.getByRole("combobox", "Provider").selectOption("local");
    await screen.getByRole("button", "Create Change Set").tap();
    await expect(screen.getByRole("region", "Review edit-plan context")).toContainText(sceneTitle);
    await screen.getByRole("button", "Generate reviewed edit plan").tap();
    await screen.getByRole("button", "Generate reviewed scene").tap();
    await screen.getByRole("button", "Exclude change hunk 1").tap();
    await expect(screen.getByRole("button", "Include change hunk 1")).toBeVisible();
    await screen.getByRole("button", "Include change hunk 1").tap();
    await screen.getByRole("button", "Apply 1 change").tap();
    await expect(screen.getByRole("button", "Undo change")).toBeVisible();
    expect((await book.json(["scene", "get", "--id", "scene-0002"])).body).toContain("found her own door");
    await screen.getByRole("button", "Undo change").tap();
    await expect(screen.getByRole("status").filter({ hasText: "Change undone" })).toBeVisible();
    expect((await book.json(["scene", "get", "--id", "scene-0002"])).body.trimEnd()).toBe(original);

    await screen.getByRole("button", /^Settings \(/).tap();
    await expect(screen.getByText("Completed", { exact: true })).toBeVisible();
    await browser.reload();
    await expect(screen.getByRole("heading", "Private Product Dashboard")).toBeVisible();
    await expect(screen.getByText("Completed", { exact: true })).toBeVisible();
    for (const label of ["scene created", "change reviewed", "change applied", "change undone"]) {
      await expect(screen.getByText(`✓ ${label}`, { exact: true })).toBeVisible();
    }
    // These label/value fields have no semantic group, so use the web engine's
    // documented XPath seam to read the value beside each visible label.
    await expect(browser.locator('xpath=//span[normalize-space(.)="Active days"]/parent::*').getByText("1", { exact: true })).toBeVisible();
    await expect(browser.locator('xpath=//span[normalize-space(.)="Reviewed hunks"]/parent::*').getByText("2", { exact: true })).toBeVisible();
    await expect(screen.getByText("1 / 1", { exact: true })).toBeVisible();
    const dashboard = await book.json(["metrics", "dashboard"]);
    expect(dashboard.activation.golden_loop_completed).toBe(true);
    expect(dashboard.privacy).toEqual({ content_free: true, local_only: true, external_telemetry_enabled: false, local_signals_enabled: true, retention_days: 365 });
    expect(dashboard.trust).toEqual({ accepted_hunks: 1, rejected_hunks: 1, hunk_acceptance_rate: 0.5, applied_change_sets: 1, undone_change_sets: 1, undo_rate: 1, memory_suggestions: {} });

    const raw = await readFile(eventsPath, "utf8");
    for (const privateValue of [projectName, pausedTitle, sceneTitle, "PRIVATE-PROSE-ONLY-389", "PRIVATE-PROMPT-ONLY-389", "Mara", book.projectRoot, "scene-0002"]) {
      expect(raw).not.toContain(privateValue);
    }
    const rows = raw.trim().split("\n").map(line => JSON.parse(line));
    expect(rows.map((row: { event: string }) => row.event)).toEqual(["project_created", "scene_created", "change_hunk_decided", "change_hunk_decided", "change_set_applied", "change_set_undone"]);
    const expectedProperties = [{}, { word_count: 0 }, { decision: "rejected" }, { decision: "accepted" }, { accepted_hunks: 1, total_hunks: 1, partial: false, changed: true }, {}];
    for (let index = 0; index < rows.length; index += 1) {
      expect(Object.keys(rows[index]).sort()).toEqual(["event", "properties", "timestamp"]);
      expect(rows[index].properties).toEqual(expectedProperties[index]);
      expect(Number.isFinite(Date.parse(rows[index].timestamp))).toBe(true);
    }
    expect(dashboard.event_count).toBe(6);
    expect(await book.errors()).toEqual([]);
  } finally { await book.close(); }
});
