import { test, expect } from "@playwright/test";
import { localBook } from "./localBook";

test("coordinated undo refuses newer writing without changing another scene", async ({ page }, testInfo) => {
  const book = await localBook(page);
  async function json(args: string[]) {
    const result = await book.core(book.projectRoot, [...args, "--json"]);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  }
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("Undo protection");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await expect(page.getByRole("button", { name: "Add Scene", exact: true })).toBeVisible();
    const ids = [];
    for (const [index, title] of ["The Approach", "The Choice"].entries()) {
      await json(["scene", "add", "--title", title, "--body", "Mara began to trace the route."]);
      const proposal = await json(["proposal", "add", "--title", `Tighten ${title}`, "--instruction", "Tighten the phrasing", "--scene", `scene-000${index + 1}`]);
      ids.push(proposal.id);
      await json(["proposal", "draft", "--id", proposal.id, "--provider", "local"]);
    }
    await json(["proposal", "apply-batch", ...ids.flatMap((id) => ["--id", id])]);
    await json(["scene", "update", "--id", "scene-0002", "--body", "Mara chose a different road. This is newer author writing."]);
    const before = await Promise.all(["scene-0001", "scene-0002"].map((id) => json(["scene", "get", "--id", id])));
    const revisions = await json(["revision", "list"]);
    await page.reload();
    await page.getByRole("button", { name: "Hide first-run guide" }).click();
    await page.getByRole("button", { name: /^Changes \(/ }).click();
    await page.getByRole("button", { name: "Undo 2 scenes together", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("protect newer work; no scenes were restored");
    await expect(page.getByRole("button", { name: "Undo 2 scenes together", exact: true })).toBeEnabled();
    const after = await Promise.all(["scene-0001", "scene-0002"].map((id) => json(["scene", "get", "--id", id])));
    expect(after).toEqual(before);
    expect(await json(["revision", "list"])).toEqual(revisions);
    expect((await json(["proposal", "list"])).every((row: any) => !row.undone_at)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("newer-writing-protected.png") });
    expect(book.errors).toEqual([]);
  } finally { await book.close(); }
});
