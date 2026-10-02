import { test, expect } from "@playwright/test";
import { localBook } from "./localBook";

test("restores tabs and caret and reviews current evidence in a wide workspace", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const book = await localBook(page);
  async function json(args: string[]) {
    const result = await book.core(book.projectRoot, [...args, "--json"]);
    expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout);
  }
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Harbor Notebook");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await expect(page.getByRole("button", { name: "Add Scene", exact: true })).toBeVisible();
    await json(["scene", "add", "--title", "Before", "--body", "Nia had lost the ring finger on her right hand in childhood."]);
    const passage = "Five fingers on Nia's right hand closed around the wheel.";
    const prose = Array.from({ length: 25 }, (_, i) => `Passage ${i + 1}. Nia checked the rope against the quay. The tide had not reached the painted mark.`).join("\n\n") + "\n\n" + passage;
    await json(["scene", "add", "--title", "After", "--body", prose]);
    await json(["codex", "add", "--type", "character", "--name", "Nia"]);
    await page.reload();
    await page.getByRole("button", { name: "Hide first-run guide" }).click();
    await page.getByRole("button", { name: "Manuscript (Cmd+Shift+E)" }).click();
    await page.getByRole("navigation", { name: "Manuscript scenes" }).getByRole("button", { name: "After DRA", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Scene prose" });
    await expect(editor).toHaveValue(prose + "\n");
    await editor.evaluate((node: HTMLTextAreaElement) => { node.focus(); node.setSelectionRange(310, 320, "backward"); node.scrollTop = 150; node.dispatchEvent(new Event("select", { bubbles: true })); node.dispatchEvent(new Event("scroll", { bubbles: true })); });
    await page.getByRole("button", { name: "Plan (Cmd+Shift+P)" }).click();
    await page.getByRole("tab", { name: "After" }).click();
    await expect.poll(() => editor.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([310, 320]);
    await page.reload();
    await expect(page.getByRole("tab", { name: "Plan" })).toBeVisible();
    await expect(editor).toHaveValue(prose + "\n");
    await expect.poll(() => editor.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([310, 320]);
    // A bookmark must reload external changes, then relocate a unique passage.
    await json(["scene", "update", "--id", "scene-0002", "--body", "A new opening.\n\n" + prose]);
    await page.reload();
    await expect(editor).toHaveValue("A new opening.\n\n" + prose + "\n");
    await expect.poll(() => editor.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([326, 336]);
    await page.getByRole("button", { name: "Story Memory (Cmd+Shift+X)" }).click();
    await page.getByRole("button", { name: "Canon & Continuity", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Findings to review" })).toBeVisible();
    const finding = page.getByRole("article", { name: "Possible physical-detail mismatch" });
    await expect(finding.getByText(passage, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("evidence-workspace.png"), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 900, height: 800 });
    await expect.poll(() => page.locator(".sidebar").evaluate(node => node.getBoundingClientRect().width)).toBe(0);
    await expect(finding.getByText(passage, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("evidence-workspace-narrow.png"), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 1400, height: 900 });
    await finding.getByRole("button", { name: "Open evidence 2 in After" }).click();
    await expect.poll(() => editor.evaluate((node: HTMLTextAreaElement) => node.value.slice(node.selectionStart, node.selectionEnd))).toBe(passage);
    await editor.evaluate((node: HTMLTextAreaElement) => { node.setSelectionRange(42, 42); node.dispatchEvent(new Event("select", { bubbles: true })); });
    await page.getByRole("tab", { name: "Plan", exact: true }).click();
    await page.getByRole("tab", { name: "After", exact: true }).click();
    await expect.poll(() => editor.evaluate((node: HTMLTextAreaElement) => node.selectionStart)).toBe(42);
    expect(book.errors).toEqual([]);
  } finally { await book.close(); }
});
