import { test, expect } from "@playwright/test";
import { localBook } from "./localBook";

// Everyday writing behaviour in the prose field, exercised in a real browser
// against the real Python core: typography, emphasis, undo/redo, find and
// replace, a page that grows with its prose, and help that appears on selection.
test("the prose page types, formats, finds and grows like a writing surface", async ({ page }) => {
  const book = await localBook(page);
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Lantern Cartographer");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await page.getByPlaceholder("New scene title...").fill("The Moving Map");
    await page.getByRole("button", { name: "Add Scene", exact: true }).click();
    const prose = page.getByRole("textbox", { name: "Scene prose" });
    await prose.click();

    // Nothing is offered until there is a selection to act on.
    await expect(page.getByRole("button", { name: "Rewrite", exact: true })).toBeHidden();

    // Straight quotes and double hyphens become typographic as they are typed.
    await page.keyboard.type(`"It isn't supposed to do that," Ivo said--and the map's red line crept on.`);
    const typed = "“It isn’t supposed to do that,” Ivo said—and the map’s red line crept on.";
    await expect(prose).toHaveValue(typed);

    // Cmd/Ctrl+I stores emphasis as Markdown; Undo and Redo both work, and
    // Redo no longer opens focus mode.
    await prose.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(4, 9));
    await page.keyboard.press("ControlOrMeta+i");
    const emphasised = typed.replace("isn’t", "*isn’t*");
    await expect(prose).toHaveValue(emphasised);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(prose).toHaveValue(typed);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(prose).toHaveValue(emphasised);
    await expect(page.getByRole("button", { name: "Exit focus mode" })).toHaveCount(0);

    // The smart-punctuation preference is honoured.
    await page.evaluate(() => localStorage.setItem("openauthor.smartPunctuation", "false"));
    await prose.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(node.value.length, node.value.length));
    await page.keyboard.type(` "Plain."`);
    await expect(prose).toHaveValue(`${emphasised} "Plain."`);
    await page.evaluate(() => localStorage.removeItem("openauthor.smartPunctuation"));

    // A long scene scrolls as one page; the field itself never scrolls.
    const paragraph = "Mara unrolled the map beside the lamp and watched the red line move toward the harbor, where the lamps were being lit one by one.";
    await prose.fill(Array.from({ length: 40 }, (_, index) => `${index + 1}. ${paragraph}`).join("\n\n"));
    const size = await prose.evaluate((node: HTMLTextAreaElement) => ({ scroll: node.scrollHeight, client: node.clientHeight }));
    expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
    expect(size.client).toBeGreaterThan(1500);

    // Find highlights matches, steps through them and replaces in one undo step.
    await prose.focus();
    await page.keyboard.press("ControlOrMeta+f");
    const find = page.getByRole("search", { name: "Find in this scene" });
    await find.getByRole("textbox", { name: "Find in scene" }).fill("harbor");
    await expect(find.getByRole("status")).toHaveText("1 of 40");
    await page.keyboard.press("Enter");
    await expect(find.getByRole("status")).toHaveText("2 of 40");
    await expect(page.locator(".find-mark")).toHaveCount(40);
    await find.getByRole("button", { name: "Replace", exact: true }).click();
    await find.getByRole("textbox", { name: "Replace with" }).fill("harbour");
    await find.getByRole("button", { name: "Replace all", exact: true }).click();
    await expect(find.getByRole("status")).toHaveText("No matches");
    await expect(prose).toHaveValue(/toward the harbour, where/);
    await page.keyboard.press("Escape");
    await expect(find).toHaveCount(0);

    // Selecting a passage brings up the passage actions without moving the prose.
    const before = await prose.evaluate(node => node.getBoundingClientRect().top);
    await prose.evaluate((node: HTMLTextAreaElement) => {
      node.focus();
      node.setSelectionRange(3, 40);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await expect(page.getByRole("toolbar", { name: "Ask for help with the selected passage" }).getByRole("button", { name: "Rewrite", exact: true })).toBeVisible();
    expect(await prose.evaluate(node => node.getBoundingClientRect().top)).toBe(before);

    await prose.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const saved = JSON.parse((await book.core(book.projectRoot, ["scene", "get", "--id", "scene-0001", "--json"])).stdout);
    expect(saved.body).toContain("toward the harbour, where");
    expect(book.errors).toEqual([]);
  } finally {
    await book.close();
  }
});
