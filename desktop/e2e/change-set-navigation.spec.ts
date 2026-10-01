import { test, expect } from "@playwright/test";
import { localBook } from "./localBook";

test("keeps document tabs usable while preparing a Change Set", async ({ page }) => {
  const book = await localBook(page);
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("Navigation check");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await expect(page.getByRole("button", { name: "Add Scene", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Story Memory \(/ }).click();
    await page.getByRole("button", { name: "Canon & Continuity", exact: true }).click();
    await page.getByRole("button", { name: /^Changes \(/ }).click();
    await page.getByTitle("Create a reviewable Change Set").click();
    await expect(page.getByRole("textbox", { name: "What should change?" })).toBeVisible();
    await page.getByRole("tab", { name: "Canon & Continuity", exact: true }).click();
    await expect(page.getByRole("region", { name: "Canon Facts", exact: true })).toBeVisible();
    expect(book.errors).toEqual([]);
  } finally { await book.close(); }
});
