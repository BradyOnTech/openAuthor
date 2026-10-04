import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { localBook } from "./localBook";

test("keeps an oversized chapter question and retries with complete scene context", async ({ page }, testInfo) => {
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
    // Repeated original prose is a deterministic capacity fixture, not a
    // literary-quality benchmark. Each individual scene fits the default cap.
    const prose = "Mara walked through the missing street and counted each door. ".repeat(600);
    for (const title of ["The first crossing", "The second crossing"]) {
      await page.getByPlaceholder("New scene title...").fill(title);
      await page.getByRole("button", { name: "Add Scene", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Scene title", exact: true })).toHaveValue(title);
      await page.getByRole("textbox", { name: "Scene prose" }).fill(prose);
      await page.getByRole("textbox", { name: "Scene prose" }).press("Control+s");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    }
    const act = await json(["plan", "act-add", "--title", "The Return"]);
    const chapter = await json(["plan", "chapter-add", "--act", act.id, "--title", "Two crossings"]);
    for (const id of ["scene-0001", "scene-0002"]) await json(["plan", "scene-assign", "--scene", id, "--chapter", chapter.id]);
    await page.getByRole("button", { name: "Assistant (Cmd+L)" }).click();
    await page.getByTitle("New thread", { exact: true }).click();
    await page.getByRole("combobox", { name: "Assistant conversation scope" }).selectOption("chapter");
    await page.getByRole("combobox", { name: "Assistant chapter scope" }).selectOption({ label: "Two crossings" });
    const composer = page.getByPlaceholder("Type a message... (@ to mention)");
    const question = "Where does this passage repeat itself?";
    await composer.fill(question);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText(/Required Assistant input exceeds the configured input token ceiling/)).toBeVisible();
    await expect(composer).toHaveValue(question);
    await expect(composer).toBeEnabled();
    // Errors must remain readable without covering recovery controls, including
    // when a narrow desktop window turns the sidebars into overlays.
    const alert = page.getByRole("alert");
    const guide = page.getByRole("complementary", { name: "Getting started" });
    for (const viewport of [{ width: 1400, height: 900 }, { width: 1000, height: 700 }, { width: 820, height: 700 }]) {
      await page.setViewportSize(viewport);
      const notice = await alert.boundingBox();
      const input = await composer.boundingBox();
      expect(notice).not.toBeNull();
      expect(input).not.toBeNull();
      expect(notice!.y + notice!.height).toBeLessThanOrEqual(input!.y);
      const onboarding = await guide.boundingBox();
      expect(onboarding).not.toBeNull();
      expect(onboarding!.y + onboarding!.height).toBeLessThanOrEqual(input!.y);
      await page.getByRole("button", { name: "Send", exact: true }).click({ trial: true });
    }
    await page.setViewportSize({ width: 1400, height: 900 });
    const [thread] = await json(["chat", "thread", "list"]);
    expect(await json(["chat", "message", "list", "--thread", thread.id])).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath("chapter-limit-keeps-question.png") });
    await page.getByRole("button", { name: "Hide first-run guide" }).click();
    await expect(guide).toHaveCount(0);
    await expect(alert).toBeVisible();
    await expect(composer).toHaveValue(question);

    await page.getByRole("combobox", { name: "Assistant conversation scope" }).selectOption("scene");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save as…", exact: true })).toBeVisible();
    await expect(alert).toHaveCount(0);
    const messages = await json(["chat", "message", "list", "--thread", thread.id]);
    const reply = messages.find((message: any) => message.role === "assistant");
    const pack = JSON.parse(await readFile(join(book.projectRoot, ".openauthor/workspace/chats/context-packs", `${reply.context_used.context_pack.id}.json`), "utf8"));
    expect(pack.provider_context.current_scene.map((scene: any) => scene.id)).toEqual(["scene-0002"]);
    expect(pack.provider_context.current_scene[0].body.trim()).toBe(prose.trim());
    expect(pack.provider_context.nearby_scenes).toEqual([]);
    expect(pack.budget.used).toBeLessThanOrEqual(pack.budget.ceiling);
    expect(pack.budget.allocations.response_reserve).toBe(1200);
    await page.getByText("Context used", { exact: true }).click();
    await expect(page.getByText(/Estimated request:.*16,000 tokens/)).toBeVisible();
    await expect(page.getByText(/optional context item\(s\) omitted by policy/)).toBeVisible();
    for (const id of ["scene-0001", "scene-0002"]) expect((await json(["scene", "get", "--id", id])).body.trim()).toBe(prose.trim());
    await page.screenshot({ path: testInfo.outputPath("scene-retry-complete-context.png") });
    expect(book.errors).toEqual([]);
  } finally { await book.close(); }
});
