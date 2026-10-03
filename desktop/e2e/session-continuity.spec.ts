import { test, expect } from "@playwright/test";
import { localBook } from "./localBook";

for (const cachedProjectId of [true, false]) {
  test(`restores the selected activity beside recovered document tabs ${cachedProjectId ? "with" : "without"} a cached project ID`, async ({ page }, testInfo) => {
    const book = await localBook(page);
    try {
      await page.goto("/");
      await page.getByRole("button", { name: "New Project", exact: true }).click();
      await page.getByRole("textbox", { name: "Novel title" }).fill("Navigation acceptance");
      await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
      await page.getByRole("button", { name: "Create novel", exact: true }).click();
      await page.getByPlaceholder("New scene title...").fill("The Ferry Office");
      await page.getByRole("button", { name: "Add Scene", exact: true }).click();
      await expect(page.getByRole("tab", { name: "The Ferry Office", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Hide first-run guide" }).click();
      const plan = page.getByRole("button", { name: "Plan (Cmd+Shift+P)", exact: true });
      const manuscript = page.getByRole("button", { name: "Manuscript (Cmd+Shift+E)", exact: true });
      const search = page.getByRole("button", { name: "Search (Cmd+Shift+F)", exact: true });
      await plan.click();
      await page.getByRole("textbox", { name: "Synopsis", exact: true }).fill("Unfinished navigation notes.");
      await expect(plan).toHaveAttribute("aria-pressed", "true");
      if (!cachedProjectId) await page.evaluate(() => localStorage.removeItem("openauthor.activeProjectId"));
      await page.reload();
      await expect(page.getByRole("tab", { name: "Plan", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tab", { name: "The Ferry Office", exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Synopsis", exact: true })).toHaveValue("Unfinished navigation notes.");
      await expect.soft(plan, "restored Plan navigation").toHaveAttribute("aria-pressed", "true");
      await expect.soft(manuscript, "inactive Manuscript navigation").toHaveAttribute("aria-pressed", "false");

      // A tool sidebar can intentionally stay open beside a different document.
      await search.click();
      await expect(search).toHaveAttribute("aria-pressed", "true");
      if (!cachedProjectId) await page.evaluate(() => localStorage.removeItem("openauthor.activeProjectId"));
      await page.reload();
      await expect(page.getByRole("tab", { name: "Plan", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect.soft(search, "restored explicit Search navigation").toHaveAttribute("aria-pressed", "true");
      await expect.soft(plan, "document restoration does not select Plan sidebar").toHaveAttribute("aria-pressed", "false");
      const savedPlan = await book.core(book.projectRoot, ["plan", "get", "--json"]);
      expect(savedPlan.status, savedPlan.stderr).toBe(0);
      expect(JSON.parse(savedPlan.stdout).brief.synopsis).toBe("");
      expect(book.errors).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("restored-navigation.png") });
    } finally {
      await book.close();
    }
  });
}

test("recovers Plan text, reading position and an unfinished voice assessment after reload", async ({ page }, testInfo) => {
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
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Harbor Notebook");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await expect(page.getByRole("button", { name: "Add Scene", exact: true })).toBeVisible();
    const excerpt = 'Mara held the brake. "Use your belt," Ivo said. She threw it toward the boy.';
    await json(["scene", "add", "--title", "Dawn", "--body", excerpt]);
    const longProse = Array.from({ length: 35 }, (_, i) => `Passage ${i + 1}. Mara checked the rope against the quay. The tide had not reached the painted mark. She sat beside the empty winch and listened to the water beneath its housing.`).join("\n\n");
    await json(["scene", "add", "--title", "Dusk", "--body", longProse]);
    const act = await json(["plan", "act-add", "--title", "Harbor"]);
    const first = await json(["plan", "chapter-add", "--act", act.id, "--title", "Morning"]);
    const last = await json(["plan", "chapter-add", "--act", act.id, "--title", "Evening"]);
    await json(["plan", "scene-assign", "--scene", "scene-0001", "--chapter", first.id]);
    await json(["plan", "scene-assign", "--scene", "scene-0002", "--chapter", last.id]);
    const before = await json(["scene", "get", "--id", "scene-0002"]);
    await page.reload();
    await page.getByRole("button", { name: "Hide first-run guide" }).click();
    await page.getByRole("button", { name: /^Plan \(/ }).click();
    await page.getByRole("textbox", { name: "Synopsis", exact: true }).fill("Unfinished thoughts about the missing ferry.");
    await page.getByPlaceholder("New act title").fill("Return to the harbor");
    await page.getByPlaceholder("Chapter title").fill("The unsealed letter");
    await page.getByRole("textbox", { name: "New beat for Dawn" }).fill("Mara refuses to let go.");
    const dawn = page.locator("article").filter({ has: page.getByRole("button", { name: "Dawn", exact: true }) });
    await dawn.getByText("Story time & labels", { exact: true }).click();
    await dawn.getByRole("textbox", { name: "Story time for Dawn" }).fill("Day 3, dawn");
    await page.reload();
    await page.getByRole("button", { name: /^Plan \(/ }).click();
    await expect(page.getByRole("textbox", { name: "Synopsis", exact: true })).toHaveValue("Unfinished thoughts about the missing ferry.");
    await expect(page.getByPlaceholder("New act title")).toHaveValue("Return to the harbor");
    await expect(page.getByPlaceholder("Chapter title")).toHaveValue("The unsealed letter");
    await expect(page.getByRole("textbox", { name: "New beat for Dawn" })).toHaveValue("Mara refuses to let go.");
    await dawn.getByText("Story time & labels", { exact: true }).click();
    await expect(dawn.getByRole("textbox", { name: "Story time for Dawn" })).toHaveValue("Day 3, dawn");
    const savedPlan = await json(["plan", "get"]);
    expect(savedPlan.brief.synopsis).toBe("");
    expect(savedPlan.acts).toHaveLength(1);
    expect(savedPlan.beats).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath("recovered-plan.png") });

    await page.getByRole("button", { name: /^Manuscript \(/ }).click();
    await page.getByRole("button", { name: "Read manuscript", exact: true }).click();
    await expect(page.getByRole("main", { name: "Manuscript reading copy" })).toBeVisible();
    await page.getByRole("combobox", { name: "Reading chapter" }).selectOption(last.id);
    const reader = page.locator(".manuscript-reader");
    await reader.evaluate((element) => { element.scrollTop = 700; });
    await expect.poll(() => reader.evaluate((element) => element.scrollTop)).toBeGreaterThan(600);
    const scroll = await reader.evaluate((element) => element.scrollTop);
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.endsWith(":reading") && JSON.parse(localStorage.getItem(key)!).offset !== null))).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: /^Manuscript \(/ }).click();
    await page.getByRole("button", { name: "Read manuscript", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Reading chapter" })).toHaveValue(last.id);
    await expect.poll(() => reader.evaluate((element, target) => Math.abs(element.scrollTop - target), scroll)).toBeLessThan(8);
    await page.screenshot({ path: testInfo.outputPath("resumed-reading.png") });

    await page.getByRole("button", { name: "Assistant (Cmd+L)" }).click();
    await page.getByRole("button", { name: "Writing Voice", exact: true }).click();
    await page.getByRole("combobox", { name: "Writing provider", exact: true }).selectOption("local");
    await page.getByRole("combobox", { name: "Preview scene" }).selectOption("scene-0001");
    await page.getByRole("textbox", { name: /Exact excerpt/ }).fill(excerpt);
    await page.getByRole("button", { name: "Compare 3 short previews", exact: true }).click();
    const sample = page.getByRole("article").first();
    await sample.getByText("Your quality assessment", { exact: true }).click();
    await sample.getByRole("textbox", { name: "Assessment notes" }).fill("Check whether Ivo's suggestion sounds like him.");
    await sample.getByRole("combobox").first().selectOption("needs_revision");
    await page.reload();
    await expect(page.getByRole("tab", { name: "Writing Voice", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Assistant (Cmd+L)" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Writing Voice", exact: true })).toBeVisible();
    await expect(sample.getByRole("textbox", { name: "Assessment notes" })).toHaveValue("Check whether Ivo's suggestion sounds like him.");
    await expect(sample.getByRole("combobox").first()).toHaveValue("needs_revision");
    expect((await json(["style", "workspace"])).previews[0].directions[0].author_review.notes).toBe("");
    await sample.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("recovered-assessment.png") });
    expect(await json(["scene", "get", "--id", "scene-0002"])).toEqual(before);
    expect(book.errors).toEqual([]);
  } finally {
    if (!page.isClosed()) await page.screenshot({ path: testInfo.outputPath("last-screen.png") }).catch(() => {});
    await book.close();
  }
});
