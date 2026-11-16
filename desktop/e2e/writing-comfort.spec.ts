import { test, expect } from "@playwright/test";
import { localBook } from "./localBook";
import { expectProse } from "./prose";

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
    await expectProse(prose, typed);

    // Cmd/Ctrl+I stores emphasis as Markdown; Undo and Redo both work, and
    // Redo no longer opens focus mode.
    await prose.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(4, 9));
    await page.keyboard.press("ControlOrMeta+i");
    const emphasised = typed.replace("isn’t", "*isn’t*");
    await expectProse(prose, emphasised);
    await page.keyboard.press("ControlOrMeta+z");
    await expectProse(prose, typed);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expectProse(prose, emphasised);
    await expect(page.getByRole("button", { name: "Exit focus mode" })).toHaveCount(0);

    // Emphasis is drawn as emphasis. Its markers show only while the caret
    // or selection touches the phrase, and the stored text never changes.
    await expect(page.locator(".prose-em")).toHaveText("isn\u2019t");
    await prose.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(node.value.length, node.value.length));
    await expect(page.locator(".prose-marker")).toHaveCount(0);
    await expect(prose).toHaveText(typed);
    await prose.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(6, 6));
    await expect(page.locator(".prose-marker")).toHaveCount(2);
    await expectProse(prose, emphasised);

    // Italics pasted from a word processor arrive as Markdown emphasis.
    await prose.evaluate((node: HTMLTextAreaElement) => {
      node.setSelectionRange(node.value.length, node.value.length);
      const clipboard = new DataTransfer();
      clipboard.setData("text/html", "<p> She did <i>not</i> turn.</p>");
      clipboard.setData("text/plain", " She did not turn.");
      node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
    });
    await expectProse(prose, `${emphasised}She did *not* turn.`);
    await page.keyboard.press("ControlOrMeta+z");
    await expectProse(prose, emphasised);

    // A line of asterisks is a scene break, and Return in the title enters the prose.
    await prose.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(node.value.length, node.value.length));
    await page.keyboard.type("\n\n***\n\nMorning.");
    await expect(page.locator(".prose-scene-break")).toHaveText("***");
    await page.getByRole("textbox", { name: "Scene title", exact: true }).click();
    await page.keyboard.press("Enter");
    await expect(prose).toBeFocused();
    expect(await prose.evaluate((node: HTMLTextAreaElement) => node.selectionStart)).toBe(0);
    for (let step = 0; step < 4; step++) await page.keyboard.press("ControlOrMeta+z");
    await expectProse(prose, emphasised);

    // Undo history survives a save and a visit to another tab.
    await prose.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Plan (Cmd+Shift+P)", exact: true }).click();
    await page.getByRole("tab", { name: "The Moving Map", exact: true }).click();
    await expectProse(prose, emphasised + "\n");
    await prose.focus();
    await page.keyboard.press("ControlOrMeta+z");
    await expectProse(prose, typed + "\n");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expectProse(prose, emphasised + "\n");

    // Text size follows the standard keys and is remembered.
    const sizeOf = () => prose.evaluate(node => getComputedStyle(node).fontSize);
    expect(await sizeOf()).toBe("17px");
    await page.keyboard.press("ControlOrMeta+=");
    expect(await sizeOf()).toBe("18px");
    await page.keyboard.press("ControlOrMeta+0");
    expect(await sizeOf()).toBe("17px");

    // The smart-punctuation preference is honoured.
    await page.evaluate(() => localStorage.setItem("openauthor.smartPunctuation", "false"));
    await prose.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(node.value.trimEnd().length, node.value.trimEnd().length));
    await page.keyboard.type(` "Plain."`);
    await expectProse(prose, `${emphasised} "Plain."\n`);
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
    // Only the paragraphs on screen are drawn, so only their matches are marked.
    await expect(page.locator(".find-mark--current")).toHaveCount(1);
    expect(await page.locator(".find-mark").count()).toBeGreaterThan(3);
    await find.getByRole("button", { name: "Replace", exact: true }).click();
    await find.getByRole("textbox", { name: "Replace with" }).fill("harbour");
    await find.getByRole("button", { name: "Replace all", exact: true }).click();
    await expect(find.getByRole("status")).toHaveText("No matches");
    await expectProse(prose, /toward the harbour, where/);
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
