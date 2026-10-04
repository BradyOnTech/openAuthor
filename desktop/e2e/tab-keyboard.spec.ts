import { test, expect } from "@playwright/test";
import { localBook } from "./localBook";

test("keyboard tabs preserve writing, defer activation and retain focus after closing", async ({ page }, testInfo) => {
  const book = await localBook(page);
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("Keyboard review");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await expect(page.getByRole("button", { name: "Add Scene", exact: true })).toBeVisible();
    const added = await book.core(book.projectRoot, ["scene", "add", "--title", "The Ferry Office", "--body", "Elin kept the ticket folded.", "--json"]);
    expect(added.status, added.stderr).toBe(0);
    await page.reload();
    await page.getByRole("button", { name: "Hide first-run guide" }).click();
    await page.getByRole("navigation", { name: "Manuscript scenes" }).getByRole("button", { name: "The Ferry Office DRA", exact: true }).click();
    const prose = page.getByRole("textbox", { name: "Scene prose" });
    await expect(prose).toHaveValue("Elin kept the ticket folded.\n");
    await prose.fill("Elin kept the ticket folded. She waited beside the ledger.\n");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Plan (Cmd+Shift+P)", exact: true }).click();
    const planTab = page.getByRole("tab", { name: "Plan", exact: true });
    await expect(planTab).toHaveAttribute("aria-selected", "true");
    const scenePanelId = await page.getByRole("tab", { name: "The Ferry Office", exact: true }).getAttribute("aria-controls");
    expect(scenePanelId).toBeTruthy();
    expect(await page.evaluate(id => document.getElementById(id!)?.hidden, scenePanelId)).toBe(true);
    await planTab.focus();
    await page.keyboard.press("ArrowLeft");
    const sceneTab = page.getByRole("tab", { name: "The Ferry Office", exact: true });
    await expect(sceneTab).toBeFocused();
    await expect(planTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Scene Inbox" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(sceneTab).toHaveAttribute("aria-selected", "true");
    await expect(prose).toHaveValue("Elin kept the ticket folded. She waited beside the ledger.\n");
    const panel = page.getByRole("tabpanel", { name: "The Ferry Office", exact: true });
    await expect(panel).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("keyboard-scene-panel.png"), animations: "disabled" });
    // Leaving the tab list resets its entry point to the selected document.
    await sceneTab.focus(); await page.keyboard.press("End");
    await expect(planTab).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close Plan", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sceneTab).toBeFocused();
    await expect(prose).toHaveValue("Elin kept the ticket folded. She waited beside the ledger.\n");
    const saved = await book.core(book.projectRoot, ["scene", "get", "--id", "scene-0001", "--json"]);
    expect(saved.status, saved.stderr).toBe(0);
    expect(JSON.parse(saved.stdout).body).toBe("Elin kept the ticket folded. She waited beside the ledger.\n");
    await page.reload();
    await expect(sceneTab).toHaveAttribute("aria-selected", "true");
    await expect(prose).toHaveValue("Elin kept the ticket folded. She waited beside the ledger.\n");
    expect(book.errors).toEqual([]);
  } finally { await book.close(); }
});
