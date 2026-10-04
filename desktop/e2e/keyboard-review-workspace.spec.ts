import { test, expect, type Locator } from "@playwright/test";
import { localBook } from "./localBook";

test.use({ viewport: { width: 1280, height: 800 } });

async function chooseWithKeyboard(select: Locator, label: string) {
  const options = await select.evaluate((node: HTMLSelectElement) => Array.from(node.options).map(option => option.text));
  const target = options.indexOf(label);
  expect(target, `Keyboard destination ${label}`).toBeGreaterThanOrEqual(0);
  await select.focus();
  // Headless macOS popup arrows fail even on a bare select. Native typeahead
  // cycles matching initials in both engines, including duplicate prefixes.
  // Its verified buffer expiry prevents a preceding choice from joining keys.
  await select.page().waitForTimeout(1200);
  for (let step = 0; step <= options.length; step++) {
    if (await select.evaluate((node: HTMLSelectElement) => node.selectedIndex) === target) break;
    await select.page().keyboard.press(label.charAt(0).toLowerCase());
  }
  await select.page().keyboard.press("Enter");
  await select.page().keyboard.press("Tab");
  await expect(select.locator("option:checked")).toHaveText(label);
}

test("Command Palette announces selection, contains focus and resumes exact prose", async ({ page }, testInfo) => {
  const book = await localBook(page);
  async function json(args: string[]) {
    const result = await book.core(book.projectRoot, [...args, "--json"]);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  }
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("Keyboard navigation acceptance");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await expect(page.getByRole("button", { name: "Add Scene", exact: true })).toBeVisible();
    for (let index = 1; index <= 10; index++) {
      await json(["scene", "add", "--title", `Harbor ${String(index).padStart(2, "0")}`, "--body", `Elin kept ticket ${index} folded.`]);
    }
    await page.reload();
    await page.getByRole("button", { name: "Hide first-run guide" }).click();
    await page.getByRole("navigation", { name: "Manuscript scenes" }).getByRole("button", { name: "Harbor 01 DRA", exact: true }).click();
    const prose = page.getByRole("textbox", { name: "Scene prose" });
    await expect(prose).toHaveValue("Elin kept ticket 1 folded.\n");
    await prose.evaluate((node: HTMLTextAreaElement) => { node.focus(); node.setSelectionRange(5, 5); });
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Command Palette", exact: true });
    const search = palette.getByRole("combobox", { name: "Search scenes, entities, commands", exact: true });
    const results = palette.getByRole("listbox", { name: "Search results", exact: true });
    await expect(search).toBeFocused();
    await search.fill("#Harbor");
    await expect(results.getByRole("option")).toHaveCount(10);
    await page.keyboard.press("ArrowDown");
    let selected = results.getByRole("option", { selected: true });
    await expect(selected).toContainText("Harbor 02");
    await expect(search).toHaveAttribute("aria-activedescendant", await selected.getAttribute("id") || "");
    await page.keyboard.press("Tab");
    await expect(search).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(search).toBeFocused();
    for (let index = 2; index < 10; index++) await page.keyboard.press("ArrowDown");
    selected = results.getByRole("option", { selected: true });
    await expect(selected).toContainText("Harbor 10");
    await expect(selected).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("palette-selected-last-result.png"), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await expect(prose).toBeFocused();
    expect(await prose.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([5, 5]);
    await page.keyboard.insertText("[resume] ");
    const savedBody = "Elin [resume] kept ticket 1 folded.\n";
    await expect(prose).toHaveValue(savedBody);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    expect((await json(["scene", "get", "--id", "scene-0001"])).body).toBe(savedBody);

    await page.keyboard.press("ControlOrMeta+k");
    await expect(search).toBeFocused();
    await search.fill("#missing-book-result");
    await expect(results.getByRole("option")).toHaveCount(0);
    await expect(search).not.toHaveAttribute("aria-activedescendant", /.+/);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(palette).toBeVisible();
    await search.fill("#Harbor");
    await expect(results.getByRole("option", { selected: true })).toContainText("Harbor 01");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(palette).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Harbor 02", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(prose).toHaveValue("Elin kept ticket 2 folded.\n");
    await page.screenshot({ path: testInfo.outputPath("palette-opened-second-scene.png"), animations: "disabled" });
    expect((await json(["scene", "get", "--id", "scene-0001"])).body).toBe(savedBody);
    expect(book.errors).toEqual([]);
  } finally { await book.close(); }
});

test("Plan keyboard positions persist within chapters, across chapters and in the inbox", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const book = await localBook(page);
  async function json(args: string[]) {
    const result = await book.core(book.projectRoot, [...args, "--json"]);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  }
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("Keyboard story order acceptance");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await expect(page.getByRole("button", { name: "Add Scene", exact: true })).toBeVisible();
    const act = await json(["plan", "act-add", "--title", "Harbor"]);
    const first = await json(["plan", "chapter-add", "--act", act.id, "--title", "Arrival"]);
    const second = await json(["plan", "chapter-add", "--act", act.id, "--title", "Departure"]);
    for (const title of ["A", "B", "C", "D", "E"]) {
      const scene = await json(["scene", "add", "--title", title, "--body", `Exact prose for ${title}.`]);
      if (title !== "E") await json(["plan", "scene-assign", "--scene", scene.id, "--chapter", title === "D" ? second.id : first.id]);
    }
    await page.reload();
    await page.getByRole("button", { name: "Hide first-run guide" }).click();
    await page.keyboard.press("ControlOrMeta+Shift+p");
    const synopsis = page.getByRole("textbox", { name: "Synopsis", exact: true });
    await synopsis.fill("Keep this unfinished chapter direction.");
    const position = page.getByRole("combobox", { name: "Reading position for C", exact: true });
    const chapter = page.getByRole("combobox", { name: "Move C to", exact: true });
    const move = page.getByRole("button", { name: "Move C", exact: true });
    await expect(move).toBeDisabled();
    await chooseWithKeyboard(position, "Before A");
    await expect(move).toBeEnabled();
    await move.focus();
    await move.press("Enter");
    await expect.poll(async () => (await json(["plan", "get"])).acts[0].chapters[0].scene_ids).toEqual(["scene-0003", "scene-0001", "scene-0002"]);
    await expect(position).toBeFocused();
    await expect(move).toBeDisabled();
    await expect(synopsis).toHaveValue("Keep this unfinished chapter direction.");
    await page.screenshot({ path: testInfo.outputPath("keyboard-plan-same-chapter.png"), animations: "disabled" });

    await chooseWithKeyboard(position, "Before B");
    await move.focus();
    await move.press("Enter");
    await expect.poll(async () => (await json(["plan", "get"])).acts[0].chapters[0].scene_ids).toEqual(["scene-0001", "scene-0003", "scene-0002"]);
    await expect(position).toBeFocused();

    await chooseWithKeyboard(chapter, "Harbor · Departure");
    await chooseWithKeyboard(position, "Before D");
    await move.focus();
    await move.press("Enter");
    await expect.poll(async () => (await json(["plan", "get"])).acts[0].chapters.map((row: { scene_ids: string[] }) => row.scene_ids)).toEqual([["scene-0001", "scene-0002"], ["scene-0003", "scene-0004"]]);
    await expect(position).toBeFocused();

    await chooseWithKeyboard(chapter, "Unassigned scene inbox");
    await chooseWithKeyboard(position, "Before E");
    await move.focus();
    await move.press("Enter");
    await expect.poll(async () => (await json(["plan", "get"])).unassigned_scene_ids).toEqual(["scene-0003", "scene-0005"]);
    await expect(position).toBeFocused();
    await expect(synopsis).toHaveValue("Keep this unfinished chapter direction.");
    await page.reload();
    await expect(position.locator("option:checked")).toHaveText("Before E");
    await expect(move).toBeDisabled();
    await expect(synopsis).toHaveValue("Keep this unfinished chapter direction.");
    const saved = await json(["plan", "get"]);
    expect(saved.brief.synopsis).toBe("");
    expect(saved.acts[0].chapters.map((row: { scene_ids: string[] }) => row.scene_ids)).toEqual([["scene-0001", "scene-0002"], ["scene-0004"]]);
    for (let index = 1; index <= 5; index++) expect((await json(["scene", "get", "--id", `scene-000${index}`])).body).toBe(`Exact prose for ${String.fromCharCode(64 + index)}.\n`);
    await page.screenshot({ path: testInfo.outputPath("keyboard-plan-inbox-reloaded.png"), animations: "disabled" });
    expect(book.errors).toEqual([]);
  } finally { await book.close(); }
});
