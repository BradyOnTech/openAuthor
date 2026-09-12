import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { localBook } from "./localBook";

test("reviews distant evidence and keeps coordinated revisions usable in a book-sized project", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const book = await localBook(page);
  async function json(args: string[]) {
    const result = await book.core(book.projectRoot, [...args, "--json"]);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  }
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Borrowed Coast");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await expect(page.getByRole("button", { name: "Add Scene", exact: true })).toBeVisible();
    const repository = fileURLToPath(new URL("../../", import.meta.url));
    const seeded = await promisify(execFile)(process.env.OPENAUTHOR_TEST_PYTHON || "python3", [
      fileURLToPath(new URL("../../tests/fixtures/editorial_workload.py", import.meta.url)), book.projectRoot,
    ], { cwd: repository, env: { ...process.env, PYTHONPATH: repository, OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" }, maxBuffer: 8 * 1024 * 1024, timeout: 30_000 });
    const fixture = JSON.parse(seeded.stdout);
    expect(fixture.scene_count).toBe(64);
    expect(fixture.word_count).toBeGreaterThan(30_000);
    console.info(`Editorial workload: ${fixture.word_count} words, 64 scenes, 16 chapters; synthetic surrounding prose.`);
    const deadline = await json(["memory", "fact-add", "--predicate", "Bell deadline", "--value", "The seventh bell must ring before dawn.",
      "--evidence-json", JSON.stringify([{ scene_id: "scene-0001", excerpt: "The seventh bell must ring before dawn." }])]);
    const evidence = await json(["retrieval", "query", "--text", "tide key western bridge", "--limit", "8", "--require-fresh"]);
    expect(evidence.results.map((row: any) => row.source_ref)).toEqual(expect.arrayContaining(["scene-0001", "scene-0032", "scene-0048"]));
    await page.reload();
    await page.getByRole("button", { name: "Hide first-run guide" }).click();
    await page.getByRole("button", { name: /^Changes \(/ }).click();
    await page.getByTitle("Create a reviewable Change Set").click();
    await page.getByRole("checkbox", { name: "Coordinate this revision across multiple scenes" }).check();
    await page.getByRole("checkbox", { name: "The Seventh Bell", exact: true }).check();
    await page.getByRole("textbox", { name: /Protect exactly/ }).fill("The seventh bell must ring before dawn.\nthe boundary with her finger");
    await page.getByPlaceholder(/Tighten the pacing/).fill("Tighten the opening phrasing in both scenes while preserving all names, facts, and the protected bell deadline.");
    await page.getByRole("combobox", { name: "Provider", exact: true }).selectOption("local");
    await page.getByRole("button", { name: "Create 2 Coordinated Change Sets", exact: true }).click();
    await expect(page.getByRole("button", { name: "Apply together", exact: true })).toBeEnabled();
    const pending = await json(["proposal", "list"]);
    expect(pending).toHaveLength(2);
    expect(pending.map((row: any) => row.scene_id)).toEqual(expect.arrayContaining(["scene-0001", "scene-0064"]));
    for (const id of ["scene-0001", "scene-0064"]) expect((await json(["scene", "get", "--id", id])).body.trim()).toBe(fixture.originals[id]);
    // Inspect both scene reviews before applying their shared group.
    for (const proposal of pending) {
      await page.getByRole("button", { name: `${proposal.title} — pending`, exact: true }).click();
      await expect(page.locator(".review-card__title")).toHaveText(proposal.title);
      await expect(page.getByRole("button", { name: /^Apply \d+ change/ })).toBeVisible();
    }
    // A protected-text violation in one member must block the entire group.
    const openingProposal = pending.find((row: any) => row.scene_id === "scene-0001");
    await page.getByRole("button", { name: `${openingProposal.title} — pending`, exact: true }).click();
    await page.getByRole("button", { name: "Edit change hunk 1", exact: true }).click();
    const replacement = page.getByRole("textbox", { name: "Edit replacement for hunk 1", exact: true });
    const safeReplacement = await replacement.inputValue();
    expect(safeReplacement).toContain("the boundary with her finger");
    await replacement.fill(safeReplacement.replace("the boundary with her finger", "a new boundary without measuring it"));
    await page.getByRole("button", { name: "Save hunk", exact: true }).click();
    await expect(replacement).toHaveCount(0);
    await page.getByRole("button", { name: "Apply together", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("modifies protected text");
    for (const id of ["scene-0001", "scene-0064"]) expect((await json(["scene", "get", "--id", id])).body.trim()).toBe(fixture.originals[id]);
    await page.getByRole("button", { name: "Edit change hunk 1", exact: true }).click();
    await replacement.fill(safeReplacement);
    await page.getByRole("button", { name: "Save hunk", exact: true }).click();
    await expect(replacement).toHaveCount(0);
    await page.getByRole("button", { name: "Apply together", exact: true }).click();
    await expect(page.getByText("2 scenes applied together in one reversible Revision.", { exact: true })).toBeVisible();
    const applied = await json(["proposal", "list"]);
    expect(applied.every((row: any) => row.status === "applied")).toBe(true);
    // The open review must acknowledge the shared apply without closing/reopening.
    await expect(page.getByRole("button", { name: "Undo change", exact: true })).toBeVisible();
    expect(new Set(applied.map((row: any) => row.applied_revision)).size).toBe(1);
    for (const id of ["scene-0001", "scene-0064"]) {
      const scene = await json(["scene", "get", "--id", id]);
      expect(scene.body).toContain("The seventh bell must ring before dawn.");
      expect(scene.body).not.toContain("began to");
      expect(scene.body).toContain("a route rather than a conclusion");
    }
    for (const id of ["scene-0032", "scene-0048"]) expect((await json(["scene", "get", "--id", id])).body.trim()).toBe(fixture.originals[id]);
    await page.screenshot({ path: testInfo.outputPath("coordinated-book-review.png") });
    // One action restores the exact recorded group and updates the open review.
    await page.getByRole("button", { name: "Undo 2 scenes together", exact: true }).click();
    await expect(page.getByText("2 scenes restored together in one Undo Revision.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo change", exact: true })).toHaveCount(0);
    for (const proposal of applied) {
      await expect(page.getByRole("button", { name: `${proposal.title} — undone`, exact: true })).toBeVisible();
      expect((await json(["scene", "get", "--id", proposal.scene_id])).body.trim()).toBe(fixture.originals[proposal.scene_id]);
    }
    const undone = await json(["proposal", "list"]);
    expect(new Set(undone.map((row: any) => row.undo_revision)).size).toBe(1);
    const revisions = await json(["revision", "list"]);
    expect(revisions.filter((row: any) => row.kind === "change_group_undo")).toHaveLength(1);
    expect(revisions[0].metadata.applied_revision).toBe(applied[0].applied_revision);
    await page.screenshot({ path: testInfo.outputPath("coordinated-book-undo.png") });
    await json(["retrieval", "build"]);
    await page.getByRole("button", { name: "Assistant (Cmd+L)" }).click();
    await page.getByTitle("New thread", { exact: true }).click();
    await page.getByRole("combobox", { name: "Assistant conversation scope" }).selectOption("project");
    await page.getByPlaceholder("Type a message... (@ to mention)").fill("Trace who knows about the tide key beneath the western bridge. Cite the early secret, premature knowledge and later disclosure.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save as…", exact: true })).toBeVisible();
    const [thread] = await json(["chat", "thread", "list"]);
    const messages = await json(["chat", "message", "list", "--thread", thread.id]);
    const reply = messages.find((row: any) => row.role === "assistant");
    expect(reply.context_used.retrieval.citations.map((row: any) => row.source_ref)).toEqual(expect.arrayContaining(["scene-0001", "scene-0032", "scene-0048"]));
    expect(reply.context_used.review.canon_fact_ids).toContain(deadline.id);
    expect(reply.context_used.context_pack.budget.used).toBeLessThanOrEqual(reply.context_used.context_pack.budget.ceiling);
    for (const title of ["The Hidden Key", "Knowledge Before Its Time", "The Reservoir Confession"]) {
      await expect(page.getByRole("button", { name: `○ ${title}`, exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "○ The Hidden Key", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Scene prose" })).toHaveValue(fixture.originals["scene-0001"] + "\n");
    await page.getByText("Context used", { exact: true }).click();
    await expect(page.getByText("1 accepted canon fact supplied.", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("distant-evidence-in-chat.png") });
    // Public scene reads confirm that discussing evidence and undoing the two
    // chosen revisions left every scene's prose unchanged.
    for (const id of Object.keys(fixture.originals)) expect((await json(["scene", "get", "--id", id])).body.trim()).toBe(fixture.originals[id]);
    expect(book.errors).toEqual([]);
  } finally { await book.close(); }
});
