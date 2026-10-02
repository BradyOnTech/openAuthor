import { test, expect } from "@playwright/test";
import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { localBook } from "./localBook";

test("a clean open scene follows the active Storyline before the author resumes writing", async ({ page }) => {
  const book = await localBook(page);
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Lantern Cartographer");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await page.getByPlaceholder("New scene title...").fill("Ending");
    await page.getByRole("button", { name: "Add Scene", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Scene title", exact: true })).toHaveValue("Ending");
    await page.getByRole("button", { name: /^Storylines \(/ }).click();
    await page.getByPlaceholder("Storyline name", { exact: true }).fill("Chosen responsibility");
    await page.getByPlaceholder("Hypothesis: why might this version be stronger?").fill("Mara chooses to stay.");
    await page.getByRole("button", { name: "Start Storyline", exact: true }).click();
    await expect(page.getByText("Exploring: Chosen responsibility", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Manuscript \(/ }).click();
    await page.getByRole("textbox", { name: "Scene prose" }).fill("Mara stays to repair the city.");
    await page.getByRole("textbox", { name: "Scene prose" }).press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const result = await book.core(book.projectRoot, ["scene", "get", "--id", "scene-0001", "--json"]);
    expect(JSON.parse(result.stdout).body.trim()).toBe("Mara stays to repair the city.");
    expect(book.errors).toEqual([]);
  } finally { await book.close(); }
});

test("explores an alternate ending, keeps chapter context, and integrates only the selected scene", async ({ page }, testInfo) => {
  const book = await localBook(page);
  const { sandbox, projectRoot, core } = book;
  const source = join(sandbox, "original-arc.md");
  await copyFile(fileURLToPath(new URL("./fixtures/lantern-arc.md", import.meta.url)), source);
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
    await expect(page.getByText(/6 scenes ·/)).toBeVisible();
    await page.getByRole("button", { name: "Create novel" }).click();
    await expect(page.getByRole("button", { name: /The Last Door DRA/ })).toBeVisible();

    // Fixture setup uses the same public CLI as the already-covered Plan UI.
    await json(["plan", "brief", "--synopsis", "Mara must restore seven erased families without stealing Ivo's choice.", "--style-guide", "Close third person, past tense. Preserve Ivo's blind right eye, the brass case, seven families, and the door closing before dawn."]);
    const canon = await json(["memory", "fact-add", "--predicate", "Ivo's right eye", "--value", "Blind since the accident; his left eye remains good.",
      "--evidence-json", JSON.stringify([{ scene_id: "scene-0001", excerpt: "Ivo had made it before the accident that blinded his right eye." }])]);
    const act = await json(["plan", "act-add", "--title", "The Lost Hour"]);
    for (const [title, ids] of [["The Debt", [1, 2]], ["The Crossing", [3, 4]], ["The Choice", [5, 6]]] as const) {
      const chapter = await json(["plan", "chapter-add", "--act", act.id, "--title", title]);
      for (const id of ids) await json(["plan", "scene-assign", "--scene", `scene-000${id}`, "--chapter", chapter.id]);
    }
    const originalEnding = await json(["scene", "get", "--id", "scene-0006"]);
    const originalFerry = await json(["scene", "get", "--id", "scene-0004"]);
    await page.getByRole("button", { name: /The Last Door DRA/ }).click();
    const prose = page.getByRole("textbox", { name: "Scene prose" });
    await expect(prose).toHaveValue(originalEnding.body);

    await page.getByRole("button", { name: /^Storylines \(/ }).click();
    await page.getByPlaceholder("Storyline name", { exact: true }).fill("Mara stays to repair the city");
    await page.getByPlaceholder("Hypothesis: why might this version be stronger?").fill("A chosen responsibility resolves Mara's habit of drawing boundaries and walking away.");
    await page.getByPlaceholder("Protected constraints, one per line").fill("Seven families survive.\nThe last door closes before dawn.\nIvo remains blind in his right eye.");
    await page.getByRole("button", { name: "Start Storyline", exact: true }).click();
    await expect(page.getByText("Exploring: Mara stays to repair the city", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Manuscript \(/ }).click();
    const ending = originalEnding.body.replace("She put the map in the brass case and followed Ivo home.", "She put the map in the brass case and gave Ivo the route home. She stayed to rebuild the keeper's street.");
    await prose.fill(ending);
    await prose.press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    expect((await json(["scene", "get", "--id", "scene-0006"])).body).toBe(ending);
    await page.getByRole("button", { name: /The Ferry Debt DRA/ }).click();
    await expect(prose).toHaveValue(originalFerry.body);
    const ferry = originalFerry.body.replace("They crossed in silence.", "They crossed while Ivo named the streets he wanted to see again.");
    expect(ferry).not.toBe(originalFerry.body);
    await prose.fill(ferry);
    await prose.press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    expect((await json(["scene", "get", "--id", "scene-0004"])).body).toBe(ferry);

    // Ask about the ending chapter while a different chapter's scene is open.
    await page.getByRole("button", { name: "Assistant (Cmd+L)" }).click();
    await page.getByTitle("New thread", { exact: true }).click();
    await page.getByRole("combobox", { name: "Assistant conversation scope" }).selectOption("chapter");
    await page.getByRole("combobox", { name: "Assistant chapter scope" }).selectOption({ label: "The Choice" });
    await page.getByPlaceholder("Type a message... (@ to mention)").fill("Does Mara's choice resolve the ending without erasing Ivo's agency?");
    await page.getByRole("button", { name: "Context", exact: true }).click();
    await page.getByRole("checkbox", { name: /Allow Canon fact:.*for this request/ }).check();
    await page.getByRole("button", { name: "Send reviewed context", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save as…", exact: true })).toBeVisible();
    const threads = await json(["chat", "thread", "list"]);
    const messages = await json(["chat", "message", "list", "--thread", threads[0].id]);
    const reply = messages.find((message: any) => message.role === "assistant");
    expect(reply.context_used.scene_ids).toEqual(["scene-0005", "scene-0006"]);
    const pack = await readFile(join(projectRoot, ".openauthor", "workspace", "chats", "context-packs", `${reply.context_used.context_pack.id}.json`), "utf8");
    expect(JSON.parse(pack).provider_context.project_brief.style_guide).toContain("blind right eye");
    const reviewContext = JSON.parse(pack).provider_context;
    expect(reviewContext.accepted_canon).toEqual([]);
    expect(reviewContext.story_memory.facts.map((fact: any) => fact.id)).toEqual([canon.id]);
    expect(reviewContext.active_storyline.experiment_brief.protected_constraints).toContain("Seven families survive.");
    expect(reviewContext.narrative_frame.focus_scene_ids).toEqual(["scene-0005", "scene-0006"]);
    await page.getByText("Context used", { exact: true }).click();
    await expect(page.getByText("Chapters: The Choice", { exact: true })).toBeVisible();
    await expect(page.getByText("1 accepted canon fact supplied.", { exact: true })).toBeVisible();
    await expect(page.getByText("Storyline: Mara stays to repair the city", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("chapter-review-context.png") });
    await page.getByRole("button", { name: /Regenerate/ }).click();
    await expect.poll(async () => {
      const regenerated = await json(["chat", "message", "list", "--thread", threads[0].id]);
      return regenerated.find((message: any) => message.role === "assistant")?.id ?? reply.id;
    }).not.toBe(reply.id);
    const regenerated = await json(["chat", "message", "list", "--thread", threads[0].id]);
    expect(regenerated.find((message: any) => message.role === "assistant").context_used.scene_ids).toEqual(["scene-0005", "scene-0006"]);
    await page.getByRole("button", { name: "Close side panel" }).click();

    await page.getByRole("button", { name: /^Storylines \(/ }).click();
    await page.getByRole("button", { name: "Return to Primary", exact: true }).click();
    await expect(page.getByText("Primary manuscript", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /^Manuscript \(/ }).click();
    // Primary restores its own working tabs; explicitly return to the ferry
    // scene to compare it with the experiment's version.
    await page.getByRole("button", { name: /The Ferry Debt DRA/ }).click();
    await expect(prose).toHaveValue(originalFerry.body);
    expect((await json(["scene", "get", "--id", "scene-0006"])).body).toBe(originalEnding.body);
    await page.getByRole("button", { name: /^Storylines \(/ }).click();
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await expect(page.getByRole("button", { name: "Prepare 2 Change Sets", exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: /The Ferry Debt/ }).uncheck();
    await page.screenshot({ path: testInfo.outputPath("storyline-comparison.png") });
    await page.getByRole("button", { name: "Prepare 1 Change Set", exact: true }).click();
    await page.getByRole("button", { name: /Integrate Mara stays to repair the city: The Last Door — pending/ }).click();
    await page.getByRole("button", { name: /^Apply \d+ change/ }).click();
    await expect(page.getByRole("button", { name: "Undo change", exact: true })).toBeVisible();
    expect((await json(["scene", "get", "--id", "scene-0006"])).body).toBe(ending);
    expect((await json(["scene", "get", "--id", "scene-0004"])).body).toBe(originalFerry.body);
    await page.screenshot({ path: testInfo.outputPath("selected-ending-integrated.png") });
    await page.getByRole("button", { name: "Undo change", exact: true }).click();
    await expect(prose).toHaveValue(originalEnding.body);
    expect((await json(["scene", "get", "--id", "scene-0006"])).body).toBe(originalEnding.body);
    expect(book.errors).toEqual([]);
  } finally {
    if (!page.isClosed()) await page.screenshot({ path: testInfo.outputPath("last-screen.png") }).catch(() => {});
    await book.close();
  }
});
