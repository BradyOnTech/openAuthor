import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { localBook } from "./localBook";

test("keyboard focus resumes a saved caret after restart while pointer placement remains authoritative", async ({ page }, testInfo) => {
  const book = await localBook(page);
  const checkpoints: unknown[] = [];
  async function checkpoint(stage: string) {
    checkpoints.push(await page.evaluate(({ stage, root }) => {
      const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Scene prose"]');
      const locations = Object.keys(localStorage).filter(key => key.startsWith("openauthor.location.v1:") && key.includes(root))
        .map(key => ({ key, ...JSON.parse(localStorage.getItem(key)!) }));
      return { stage, locations, editor: editor ? { start: editor.selectionStart, end: editor.selectionEnd, focused: document.activeElement === editor } : null };
    }, { stage, root: book.projectRoot }));
  }
  async function keyboardFocusProse() {
    for (let index = 0; index < 12; index++) {
      if (await page.getByRole("textbox", { name: "Scene prose" }).evaluate(node => document.activeElement === node)) return;
      await page.keyboard.press("Tab");
    }
    await expect(page.getByRole("textbox", { name: "Scene prose" })).toBeFocused();
  }
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Ferry Office");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await page.getByPlaceholder("New scene title...").fill("Receipt");
    await page.getByRole("button", { name: "Add Scene", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Scene prose" });
    const original = "Leah waited at the office. She kept the receipt folded.";
    await editor.fill(original);
    await editor.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await editor.press(process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home");
    for (let index = 0; index < 26; index++) await page.keyboard.press("ArrowRight");
    const setupMarker = " [setup verified]";
    await page.keyboard.type(setupMarker);
    const setupBody = original.slice(0, 26) + setupMarker + original.slice(26);
    await expect(editor).toHaveValue(setupBody);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await editor.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await checkpoint("before Plan");
    await page.keyboard.press("ControlOrMeta+Shift+p");
    await expect(page.getByRole("tab", { name: "Plan", exact: true })).toBeVisible();
    await checkpoint("after Plan");
    await page.reload();
    await expect(page.getByRole("tab", { name: "Plan", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Receipt", exact: true }).click();
    await expect(editor).toHaveValue(setupBody + "\n");
    await checkpoint("scene active before focus");
    await keyboardFocusProse();
    await checkpoint("scene active after keyboard focus");
    const restartMarker = " [restart verified]";
    await page.keyboard.type(restartMarker);
    const restartBody = original.slice(0, 26) + setupMarker + restartMarker + original.slice(26) + "\n";
    await expect(editor).toHaveValue(restartBody);

    await editor.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Shift+p");
    await page.getByRole("tab", { name: "Receipt", exact: true }).click();
    await expect(editor).toHaveValue(restartBody);
    await editor.click({ position: { x: 1, y: 12 } });
    await page.keyboard.type("Pointer ");
    await expect(editor).toHaveValue("Pointer " + restartBody);

    await page.keyboard.press("ArrowRight");
    const laterPosition = await editor.evaluate((node: HTMLTextAreaElement) => node.selectionStart);
    await page.getByRole("textbox", { name: "Scene title", exact: true }).click();
    await keyboardFocusProse();
    await page.keyboard.type("Later ");
    const pointerBody = "Pointer " + restartBody;
    await expect(editor).toHaveValue(pointerBody.slice(0, laterPosition) + "Later " + pointerBody.slice(laterPosition));
    await checkpoint("later keyboard focus");
    await page.getByRole("textbox", { name: "Scene title", exact: true }).click();
    await editor.fill("A deliberate replacement draft.");
    await expect(editor).toHaveValue("A deliberate replacement draft.");
    await editor.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    expect(book.errors).toEqual([]);
  } finally {
    await writeFile(testInfo.outputPath("caret-checkpoints.json"), JSON.stringify(checkpoints, null, 2) + "\n");
    await book.close();
  }
});
