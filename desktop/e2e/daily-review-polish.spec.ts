import { test, expect } from "@playwright/test";
import { localBook } from "./localBook";

test("keeps saved planning compact, recovers edits, and exposes passage actions beside long context", async ({ page }, testInfo) => {
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
    const synopsis = Array.from({ length: 12 }, (_, index) => `Chapter ${index + 1}: Mara follows a stolen hour through the harbor.`).join("\n");
    const guidance = Array.from({ length: 65 }, (_, index) => `Voice note ${index + 1}: preserve close third person and the narrator's precise, restrained observations.`).join("\n");
    await json(["plan", "brief", "--synopsis", synopsis, "--genre", "Fantasy", "--theme", "Trust", "--style-guide", guidance, "--outline", "Mara restores the missing hour without taking her friend's choice."]);
    const body = "Mara began to count.\n\n" + Array.from({ length: 16 }, (_, index) => `At marker ${index + 1}, she checked the rope against the quay. The tide had not reached the painted mark.`).join("\n\n");
    await json(["scene", "add", "--title", "The Count", "--body", body]);
    await page.reload();
    await page.getByRole("button", { name: "Hide first-run guide" }).click();
    await page.getByRole("button", { name: "Plan (Cmd+Shift+P)" }).click();
    const brief = page.getByRole("region", { name: "Project Brief", exact: true });
    await expect(brief.getByRole("button", { name: "Edit saved brief" })).toBeVisible();
    await expect(brief.getByRole("textbox", { name: "Synopsis" })).toHaveCount(0);
    expect((await brief.boundingBox())!.height).toBeLessThan(270);
    await expect(page.getByRole("heading", { name: "Scene Inbox" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("compact-saved-plan.png"), animations: "disabled" });
    await brief.getByRole("button", { name: "Edit saved brief" }).click();
    await brief.getByRole("textbox", { name: "Synopsis" }).fill("An unfinished direction worth preserving.");
    await expect(brief.getByRole("button", { name: "Collapse saved brief" })).toHaveCount(0);
    await page.reload();
    await expect(brief.getByRole("textbox", { name: "Synopsis" })).toHaveValue("An unfinished direction worth preserving.");
    await expect(brief.getByRole("button", { name: "Save Brief" })).toBeVisible();
    expect((await json(["plan", "get"])).brief.synopsis).toBe(synopsis);

    await page.getByRole("button", { name: "Manuscript (Cmd+Shift+E)" }).click();
    await page.getByRole("navigation", { name: "Manuscript scenes" }).getByRole("button", { name: "The Count DRA", exact: true }).click();
    const prose = page.getByRole("textbox", { name: "Scene prose" });
    await expect(prose).toHaveValue(body + "\n");
    await prose.evaluate((node: HTMLTextAreaElement) => { node.focus(); node.setSelectionRange(0, "Mara began to count.".length); node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); });
    await page.getByRole("button", { name: "Shorten", exact: true }).click();
    await page.getByRole("combobox", { name: "Provider", exact: true }).selectOption("local");
    await page.getByRole("button", { name: "Review context", exact: true }).click();
    const context = page.getByRole("region", { name: "Selection context and permissions" });
    const actions = page.getByRole("group", { name: "Selection request actions" });
    const generate = actions.getByRole("button", { name: "Generate reviewed edit", exact: true });
    await expect(generate).toBeVisible();
    await context.getByText("Exact app-supplied editorial context", { exact: true }).click();
    expect(await context.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await context.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect(generate).toBeInViewport();
    await expect(actions.getByRole("button", { name: "Discard selection request" })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("selection-context-actions.png"), animations: "disabled" });
    await page.setViewportSize({ width: 900, height: 800 });
    await expect.poll(() => page.locator(".sidebar").evaluate(node => node.getBoundingClientRect().width)).toBe(0);
    await expect(generate).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("selection-context-actions-narrow.png"), animations: "disabled" });
    await generate.click();
    await expect(page.getByRole("button", { name: "Accept selected replacement", exact: true })).toBeVisible();
    expect((await json(["scene", "get", "--id", "scene-0001"])).body).toBe(body + "\n");
    expect(book.errors).toEqual([]);
  } finally { await book.close(); }
});
