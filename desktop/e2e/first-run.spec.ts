import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { localBook } from "./localBook";

// A first-time author can start from a title alone, or open the built-in
// sample book and find real work waiting in it. Both run the real Python core.
test("a new novel needs only a title, and the sample book opens with work to review", async ({ page }) => {
  const book = await localBook(page);
  try {
    await page.goto("/");
    await expect(page.getByText("Write your novel with an AI that proposes and never overwrites.")).toBeVisible();

    // The folder is suggested from the title until the author chooses one.
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    const folder = page.getByRole("textbox", { name: "Project folder" });
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Salt Road");
    await expect(folder).toHaveValue(join(book.sandbox, "books", "The Salt Road"));
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Salt Road: A Novel");
    await expect(folder).toHaveValue(join(book.sandbox, "books", "The Salt Road A Novel"));
    await folder.fill(join(book.sandbox, "elsewhere"));
    await page.getByRole("textbox", { name: "Novel title" }).fill("Renamed");
    await expect(folder).toHaveValue(join(book.sandbox, "elsewhere"));
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    // The sample is an ordinary book with a Change Set and a planted slip.
    await page.getByRole("button", { name: "Explore a sample book", exact: true }).click();
    const scenes = page.getByRole("navigation", { name: "Manuscript scenes" });
    await expect(scenes.getByRole("button", { name: "The Clock Runs Ahead Draft", exact: true })).toBeVisible();
    await expect(scenes.getByRole("region", { name: "The Bell" }).getByRole("button", { name: / Draft$/ })).toHaveCount(2);
    const sampleRoot = join(book.sandbox, "books", "The Tide Clock (sample)");
    const proposals = JSON.parse((await book.core(sampleRoot, ["proposal", "list", "--json"])).stdout);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].status).toBe("pending");

    await page.getByRole("button", { name: /^Changes \(/ }).click();
    await page.getByRole("button", { name: /The Early Tide: tighten the opening paragraph/ }).click();
    await expect(page.locator(".change-word--before").first()).toBeVisible();
    await page.getByRole("button", { name: "Apply 1 change", exact: true }).click();
    await expect(page.getByRole("button", { name: "Undo change", exact: true })).toBeVisible();
    const revised = JSON.parse((await book.core(sampleRoot, ["scene", "get", "--id", "scene-0002", "--json"])).stdout);
    expect(revised.body).toContain("counting as she went because counting steadied her");

    const diagnostics = JSON.parse((await book.core(sampleRoot, ["memory", "diagnose", "--json"])).stdout);
    expect(diagnostics.diagnostics.map((row: { title: string }) => row.title)).toContain("Possible physical-detail mismatch");

    // The Assistant is ready to type: a first message starts the book's one
    // conversation and keeps the words typed while it was being created.
    await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
    const message = page.getByPlaceholder("Type a message... (@ to mention)");
    await message.fill("Who knows the tide is early?");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    await expect(message).toHaveValue("Who knows the tide is early?");
    expect(JSON.parse((await book.core(sampleRoot, ["chat", "thread", "list", "--json"])).stdout)).toHaveLength(1);

    // A second sample never overwrites the first.
    const again = JSON.parse((await book.core(book.sandbox, ["project", "suggest-root", "--name", "The Tide Clock (sample)", "--json"])).stdout);
    expect(again.path).toBe(join(book.sandbox, "books", "The Tide Clock (sample) 2"));
    expect(book.errors).toEqual([]);
  } finally {
    await book.close();
  }
});
