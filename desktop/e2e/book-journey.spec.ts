import { test, expect } from "@playwright/test";
import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { localBook } from "./localBook";

// Keep the connected author journey usable on a smaller laptop, not only a
// wide development monitor. Other journeys retain the default 1400px viewport.
test.use({ viewport: { width: 1024, height: 768 } });

test("imports a book, plans chapters, saves Memory, discusses a scene, and exports readable prose", async ({ page }, testInfo) => {
  const book = await localBook(page);
  const { sandbox, projectRoot, core } = book;
  const source = join(sandbox, "original.md");
  await copyFile(fileURLToPath(new URL("./fixtures/lantern.md", import.meta.url)), source);
  const original = await readFile(source, "utf8");
  async function json(args: string[]) {
    const result = await core(projectRoot, [...args, "--json"]);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  }
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Lantern Cartographer");
    await page.getByRole("textbox", { name: "Project folder" }).fill(projectRoot);
    await page.getByRole("button", { name: "Add existing content" }).click();
    await page.getByRole("button", { name: "Manuscript File", exact: true }).click();
    await page.getByPlaceholder("/path/to/novel.docx-or-project.scrivx").fill(source);
    await page.getByRole("combobox", { name: "Import structure" }).selectOption("headings");
    await page.getByRole("button", { name: /Preview/ }).click();
    await expect(page.getByText(/2 scenes ·/)).toBeVisible();
    await page.getByRole("button", { name: "Create novel" }).click();
    await page.getByRole("button", { name: /^Plan \(/ }).click();
    await page.getByRole("textbox", { name: "Synopsis", exact: true }).fill("A cartographer follows a living map into a city's stolen hours.");
    await page.getByRole("textbox", { name: "Genre", exact: true }).fill("Fantasy mystery");
    await page.getByRole("textbox", { name: "Style guide", exact: true }).fill("Close third person, past tense. Keep the mystery tangible.");
    await page.getByRole("button", { name: "Save Brief", exact: true }).click();
    await expect(page.getByText("Project brief saved.", { exact: true })).toBeVisible();
    await page.getByPlaceholder("New act title").fill("The Lost Hour");
    await page.getByRole("button", { name: "Add Act", exact: true }).click();
    await page.getByPlaceholder("Chapter title").fill("The Summons");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("combobox", { name: "Move The Clocktower to", exact: true }).selectOption({ label: "The Lost Hour · The Summons" });
    await page.locator("article").filter({ has: page.getByRole("button", { name: "The Clocktower", exact: true }) }).getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Move The Clocktower to", exact: true })).toHaveValue(/chapter-/);
    await page.getByRole("combobox", { name: "Move The Moving Map to", exact: true }).selectOption({ label: "The Lost Hour · The Summons" });
    await expect(page.getByRole("region", { name: "Structural move preview" })).toBeVisible();
    await page.locator("article").filter({ has: page.getByRole("button", { name: "The Moving Map", exact: true }) }).getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByText("Scene moved. Manuscript order updated.", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "New beat for The Moving Map" }).fill("The map chooses Mara's door.");
    await page.getByRole("button", { name: "Add beat to The Moving Map" }).click();
    await expect(page.getByText("Beat 1: The map chooses Mara's door.")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("book-plan.png") });
    await page.getByRole("button", { name: /^Manuscript \(/ }).click();
    const navigation = page.getByRole("navigation", { name: "Manuscript scenes" });
    const chapterNavigation = navigation.getByRole("region", { name: "The Summons" });
    await expect(chapterNavigation.getByRole("button", { name: / DRA$/ })).toHaveText(["○The ClocktowerDRA", "○The Moving MapDRA"]);
    await chapterNavigation.getByRole("button", { name: /The Summons/ }).click();
    await expect(navigation.getByRole("button", { name: "The Clocktower DRA" })).toBeHidden();
    await page.getByRole("searchbox", { name: "Filter manuscript scenes" }).fill("Clocktower");
    await expect(navigation.getByRole("button", { name: "The Clocktower DRA" })).toBeVisible();
    await expect(navigation.getByRole("button", { name: "The Moving Map DRA" })).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Filter manuscript scenes" }).fill("");
    await page.screenshot({ path: testInfo.outputPath("chapter-navigation.png") });
    await page.getByRole("button", { name: "Read manuscript", exact: true }).click();
    const reading = page.getByRole("main", { name: "Manuscript reading copy" });
    await expect(reading.getByRole("heading", { level: 3 })).toHaveText(["The Clocktower", "The Moving Map"]);
    await expect(reading).toContainText("At midnight, the line reached her own door.");
    await expect(reading.getByRole("textbox")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("chapter-reading.png") });

    await page.getByRole("button", { name: /^Story Memory \(/ }).click();
    await page.getByPlaceholder("Entity name...").fill("Mara");
    await page.getByRole("button", { name: "Add Memory Entry", exact: true }).click();
    await page.getByRole("button", { name: "◆ Mara", exact: true }).click();
    await page.getByRole("textbox", { name: "Description", exact: true }).fill("Mara is a cartographer. She keeps a brass case for maps that cannot be trusted.");
    await page.getByRole("button", { name: "Save Memory", exact: true }).click();
    await expect(page.getByText("Story Memory entry saved.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Search \(/ }).click();
    await page.getByPlaceholder("Search manuscript...").fill("brass case");
    await expect(page.getByRole("button", { name: "Open Mara", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open The Clocktower", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open The Clocktower", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Scene prose" })).toHaveValue(/missing hour/);

    await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
    await page.getByTitle("New thread", { exact: true }).click();
    await page.getByRole("combobox", { name: "Assistant conversation scope" }).selectOption("scene");
    await page.getByPlaceholder("Type a message... (@ to mention)").fill("How can I strengthen the tension in this scene while preserving Mara's character?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save as…", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save as…", exact: true }).click();
    await page.getByRole("button", { name: "Scene note", exact: true }).click();
    await expect(page.getByText(/Saved as a scene note\./)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("scene-discussion.png") });
    const activeLabel = page.getByRole("tab", { name: "The Clocktower", exact: true }).locator(".tab__label");
    // A short document title should not collapse into "T…" when sidebars are open.
    expect(await activeLabel.evaluate((element) => element.clientWidth)).toBeGreaterThanOrEqual(80);
    await expect(activeLabel).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const threads = await json(["chat", "thread", "list"]);
    const messages = await json(["chat", "message", "list", "--thread", threads[0].id]);
    expect(messages.some((message: any) => message.role === "assistant" && message.context_used.scene_ids.includes("scene-0002"))).toBe(true);

    // Continue a saved idea through Plan into the normal review workflow.
    const beforeRevision = await json(["scene", "get", "--id", "scene-0002"]);
    await page.getByRole("button", { name: "View saved note", exact: true }).click();
    const notes = page.getByRole("region", { name: "Saved notes" });
    const replyText = messages.find((message: any) => message.role === "assistant").content;
    await expect(notes).toContainText(replyText);
    await notes.getByRole("searchbox", { name: "Search saved notes" }).fill("no such idea 123");
    await expect(notes.getByText("No notes match. Try a different search or scene.")).toBeVisible();
    await notes.getByRole("searchbox", { name: "Search saved notes" }).fill("Clocktower");
    await expect(notes.getByRole("status")).toHaveText("1 of 1 notes");
    await page.screenshot({ path: testInfo.outputPath("saved-notes.png") });
    await notes.getByRole("button", { name: "Open scene: The Clocktower" }).click();
    await expect(page.getByRole("textbox", { name: "Scene prose" })).toHaveValue(beforeRevision.body);
    await page.getByRole("button", { name: "View saved note", exact: true }).click();
    await notes.getByRole("button", { name: "Plan a revision" }).click();
    await expect(page.getByRole("combobox", { name: "Scene", exact: true })).toHaveValue("scene-0002");
    const revisionRequest = page.getByRole("textbox", { name: "What should change?" });
    await expect(revisionRequest).toHaveValue(replyText);
    expect(await json(["proposal", "list"])).toHaveLength(0);
    // The author can change the target; this original passage supports the
    // deterministic provider's small tonal edit without using live inference.
    const otherScene = await json(["scene", "get", "--id", "scene-0001"]);
    await page.getByRole("combobox", { name: "Scene", exact: true }).selectOption("scene-0001");
    await revisionRequest.fill("Make the final paragraph more ominous while preserving every name and story event.");
    await page.getByRole("combobox", { name: "Provider", exact: true }).selectOption("local");
    await page.getByRole("button", { name: "Create Change Set", exact: true }).click();
    const planContext = page.getByRole("region", { name: "Review edit-plan context", exact: true });
    await expect(planContext).toContainText("The Moving Map");
    expect(await json(["proposal", "list"])).toHaveLength(0);
    await planContext.getByRole("button", { name: "Generate reviewed edit plan", exact: true }).click();
    const draftContext = page.getByRole("region", { name: "Review scene draft context", exact: true });
    await expect(draftContext).toBeVisible();
    expect((await json(["scene", "get", "--id", "scene-0001"])).body).toBe(otherScene.body);
    await draftContext.getByRole("button", { name: "Generate reviewed scene", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Apply \d+ change/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Revise from note", exact: true })).toHaveCount(0);
    expect((await json(["proposal", "list"]))).toHaveLength(1);
    expect((await json(["scene", "get", "--id", "scene-0002"])).body).toBe(beforeRevision.body);
    expect((await json(["scene", "get", "--id", "scene-0001"])).body).toBe(otherScene.body);

    await page.getByRole("button", { name: /^Settings \(/ }).click();
    await page.getByRole("combobox", { name: "Export format" }).selectOption("docx");
    const target = join(sandbox, "finished.docx");
    await page.getByPlaceholder("/path/to/manuscript.docx").fill(target);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: `Exported 2 scenes to ${target}` })).toBeVisible();
    const roundtrip = await json(["manuscript", "preview", "--source", target, "--strategy", "headings"]);
    expect(roundtrip.scene_count).toBe(2);
    expect(roundtrip.scenes.map((scene: any) => scene.title)).toEqual(["The Clocktower", "The Moving Map"]);
    expect(await readFile(source, "utf8")).toBe(original);
    await page.reload();
    await page.getByRole("button", { name: /^Plan \(/ }).click();
    await expect(page.locator(".plan-brief__synopsis")).toContainText("A cartographer follows a living map");
    await page.getByRole("button", { name: "Edit saved brief", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Synopsis", exact: true })).toHaveValue(/stolen hours/);
    await expect(page.getByText("Beat 1: The map chooses Mara's door.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Notes", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Read manuscript", exact: true }).click();
    await page.getByRole("button", { name: "Edit The Clocktower", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Scene prose" })).toHaveValue(/missing hour/);
    expect(book.errors).toEqual([]);
  } finally {
    if (!page.isClosed()) await page.screenshot({ path: testInfo.outputPath("last-screen.png") }).catch(() => {});
    await book.close();
  }
});
