import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { localBook } from "./localBook";

test("asks for Memory once, retains a cancelled question, and honors a later exclusion", async ({ page }, testInfo) => {
  const book = await localBook(page);
  async function json(args: string[]) {
    const result = await book.core(book.projectRoot, [...args, "--json"]);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  }
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Lantern Cartographer");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await page.getByRole("button", { name: /^Story Memory \(/ }).click();
    await page.getByPlaceholder("Entity name...").fill("Mara");
    await page.getByRole("button", { name: "Add Memory Entry", exact: true }).click();
    await page.getByRole("button", { name: "◆ Mara", exact: true }).click();
    await page.getByRole("textbox", { name: "Description", exact: true }).fill("PUBLIC-FACT: Mara restores the lost streets.");
    await page.getByRole("textbox", { name: "Private author notes", exact: true }).fill("PRIVATE-NOTE-FIXTURE: an unshared author reflection.");
    await page.getByRole("combobox", { name: "Assistant access", exact: true }).selectOption("ask");
    await page.getByRole("button", { name: "Save Memory", exact: true }).click();
    await expect(page.getByText("Story Memory entry saved.", { exact: true })).toBeVisible();
    const [mara] = await json(["codex", "list"]);

    await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
    await page.getByTitle("New thread", { exact: true }).click();
    await page.getByRole("combobox", { name: "Assistant conversation scope" }).selectOption("character");
    await page.getByRole("combobox", { name: "Assistant character scope" }).selectOption({ label: "Mara" });
    const composer = page.getByPlaceholder("Type a message... (@ to mention)");
    const question = "How can Mara's final choice show responsibility?";
    await composer.fill(question);
    expect((await composer.boundingBox())!.width).toBeGreaterThan(200);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const permission = page.getByRole("region", { name: "Review AI context" });
    await expect(permission).toBeVisible();
    await expect(permission.getByRole("checkbox", { name: "Allow Mara for this turn" })).not.toBeChecked();
    await expect(permission.getByRole("button", { name: "Send reviewed context" })).toBeDisabled();
    const [thread] = await json(["chat", "thread", "list"]);
    expect(await json(["chat", "message", "list", "--thread", thread.id])).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath("memory-permission.png") });
    await permission.getByRole("button", { name: "Back to message", exact: true }).click();
    await expect(composer).toHaveValue(question);
    await expect(composer).toBeEnabled();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await permission.getByRole("checkbox", { name: "Allow Mara for this turn" }).check();
    await expect(permission.getByRole("button", { name: "Send reviewed context" })).toBeEnabled();
    expect(await json(["chat", "message", "list", "--thread", thread.id])).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath("memory-permission-reviewed.png") });
    await permission.getByRole("button", { name: "Send reviewed context", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save as…", exact: true })).toBeVisible();
    const messages = await json(["chat", "message", "list", "--thread", thread.id]);
    const reply = messages.find((message: any) => message.role === "assistant");
    const pack = await readFile(join(book.projectRoot, ".openauthor/workspace/chats/context-packs", `${reply.context_used.context_pack.id}.json`), "utf8");
    expect(pack).toContain("PUBLIC-FACT");
    expect(pack).not.toContain("PRIVATE-NOTE-FIXTURE");
    expect(JSON.parse(pack).provider_context.codex_entities.map((entry: any) => entry.id)).toEqual([mara.id]);
    expect(reply.context_used.privacy.one_time_approval).toBe(true);
    expect(reply.context_used.profile.scope).toBe("character");
    expect((await json(["codex", "get", "--id", mara.id])).notes).toContain("PRIVATE-NOTE-FIXTURE");

    await composer.fill("An unfinished different question");
    await page.getByRole("button", { name: /Regenerate/ }).click();
    await expect(permission).toBeVisible();
    await expect(permission.getByRole("checkbox", { name: "Allow Mara for this turn" })).not.toBeChecked();
    await expect(permission.getByRole("button", { name: "Send reviewed context" })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("memory-regeneration-fresh-permission.png") });
    await permission.getByRole("button", { name: "Back to message", exact: true }).click();
    await expect(composer).toHaveValue("An unfinished different question");
    await page.getByRole("button", { name: /Regenerate/ }).click();
    await permission.getByRole("checkbox", { name: "Allow Mara for this turn" }).check();
    await permission.getByRole("button", { name: "Send reviewed context", exact: true }).click();
    await expect.poll(async () => {
      const refreshed = await json(["chat", "message", "list", "--thread", thread.id]);
      return refreshed.find((message: any) => message.role === "assistant")?.id ?? reply.id;
    }).not.toBe(reply.id);
    const regenerated = await json(["chat", "message", "list", "--thread", thread.id]);
    expect(regenerated.find((message: any) => message.role === "assistant").context_used.codex_entity_ids).toEqual([mara.id]);
    await expect(composer).toHaveValue("An unfinished different question");

    await composer.fill(question);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(permission).toBeVisible();
    await permission.getByRole("button", { name: "Back to message", exact: true }).click();
    await page.getByRole("combobox", { name: "Assistant access", exact: true }).selectOption("exclude");
    await page.getByRole("button", { name: "Save Memory", exact: true }).click();
    await expect.poll(async () => (await json(["codex", "get", "--id", mara.id])).ai_visibility).toBe("exclude");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(permission.getByText(/Mara.*is excluded from AI context/)).toBeVisible();
    await expect(permission.getByRole("checkbox", { name: "Allow Mara for this turn" })).toHaveCount(0);
    await expect(permission.getByRole("button", { name: "Send reviewed context" })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("memory-permission-excluded.png") });
    await permission.getByRole("button", { name: "Back to message", exact: true }).click();
    await expect(composer).toHaveValue(question);
    expect(await json(["chat", "message", "list", "--thread", thread.id])).toHaveLength(2);
    expect(book.errors).toEqual([]);
  } finally {
    if (!page.isClosed()) await page.screenshot({ path: testInfo.outputPath("last-screen.png") }).catch(() => {});
    await book.close();
  }
});
