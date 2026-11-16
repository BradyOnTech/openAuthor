import { test, expect } from "@playwright/test";
import { localBook } from "./localBook";

// Settings shows how much history a book holds and lets the author decide
// whether old automatic saves are thinned. The thinning itself is covered by
// the engine's tests; this checks the choice reaches the book and that a run
// on a new book removes nothing.
test("the author controls history thinning from Settings", async ({ page }) => {
  const book = await localBook(page);
  const policy = async () => JSON.parse((await book.core(book.projectRoot, ["revision", "retention", "--json"])).stdout);
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Lantern Cartographer");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await page.getByPlaceholder("New scene title...").fill("The Moving Map");
    await page.getByRole("button", { name: "Add Scene", exact: true }).click();
    const prose = page.getByRole("textbox", { name: "Scene prose" });
    await prose.fill("Mara unrolled the map beside the lamp.");
    await prose.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.keyboard.press("ControlOrMeta+,");
    const thinning = page.getByRole("checkbox", { name: "Thin old automatic saves" });
    await expect(thinning).toBeChecked();
    const before = await policy();
    expect(before.policy).toEqual({ enabled: true, keep_all_days: 7, daily_after_days: 90 });
    await expect(page.getByText(new RegExp(`This book holds ${before.store.revisions} of them`))).toBeVisible();
    await expect(page.getByText(/Everything from the last 7 days is kept/)).toBeVisible();

    await page.getByRole("button", { name: "Thin now", exact: true }).click();
    await expect(page.getByText("Nothing old enough to thin yet.", { exact: true })).toBeVisible();
    expect((await policy()).store.revisions).toBe(before.store.revisions);

    await thinning.uncheck();
    await expect.poll(async () => (await policy()).policy.enabled).toBe(false);
    await expect(page.getByRole("button", { name: "Thin now", exact: true })).toBeDisabled();
    await thinning.check();
    await expect.poll(async () => (await policy()).policy.enabled).toBe(true);
    expect(book.errors).toEqual([]);
  } finally {
    await book.close();
  }
});
