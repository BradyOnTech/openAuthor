import { test, expect } from "@playwright/test";
import { localBook } from "./localBook";

test("recovers Canon assertion corrections after navigation and restart without silently replacing a stale fact", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const book = await localBook(page);
  async function json(args: string[]) {
    const result = await book.core(book.projectRoot, [...args, "--json"]);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  }
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Repainted Gate");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await expect(page.getByRole("button", { name: "Add Scene", exact: true })).toBeVisible();
    const body = "The gate was blue. Mara repainted it green. The gate was green.";
    await json(["scene", "add", "--title", "The Gate", "--body", body]);
    const added = await json(["memory", "fact-add", "--predicate", "gate color", "--value", "blue", "--evidence-json", JSON.stringify([{ scene_id: "scene-0001", excerpt: "The gate was blue." }])]);
    const original = (await json(["memory", "fact-list", "--for-editing"]))[0];
    await page.reload();
    await page.getByRole("button", { name: "Hide first-run guide" }).click();
    await page.getByRole("button", { name: "Story Memory (Cmd+Shift+X)" }).click();
    await page.getByRole("button", { name: "Canon & Continuity", exact: true }).click();
    await page.getByText("Add or update story records", { exact: true }).click();
    const card = page.getByRole("article", { name: "Story: gate color", exact: true });
    await card.getByRole("button", { name: "Correct or withdraw fact" }).click();
    await card.getByRole("textbox", { name: "Value", exact: true }).fill("green");
    await card.getByRole("textbox", { name: "Supporting passage 1", exact: true }).fill("The gate was green.");
    await page.getByRole("button", { name: "Plan (Cmd+Shift+P)" }).click();
    await page.getByRole("tab", { name: "Story Memory", exact: true }).click();
    await page.getByText("Add or update story records", { exact: true }).click();
    await expect(card.getByRole("textbox", { name: "Value", exact: true })).toHaveValue("green");
    await expect(card.getByText("Recovered unsaved correction. Review and save when ready.", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByText("Add or update story records", { exact: true }).click();
    await expect(card.getByRole("textbox", { name: "Value", exact: true })).toHaveValue("green");
    await expect(card.getByRole("textbox", { name: "Supporting passage 1", exact: true })).toHaveValue("The gate was green.");
    expect((await json(["memory", "fact-list", "--for-editing"]))[0].value).toBe("blue");
    await card.screenshot({ path: testInfo.outputPath("recovered-canon-correction.png"), animations: "disabled" });

    await json(["memory", "fact-update", "--id", added.id, "--expected-version", original.edit_version, "--changes-json", JSON.stringify({ value: "blue before repaint" })]);
    await page.reload();
    await page.getByText("Add or update story records", { exact: true }).click();
    await expect(card.getByText("blue before repaint", { exact: true })).toBeVisible();
    await expect(card.getByRole("textbox", { name: "Value", exact: true })).toHaveValue("green");
    await expect(card.getByRole("button", { name: "Save fact correction" })).toBeDisabled();
    const recovery = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("openauthor.canonCorrection.v1:")).map(([, raw]) => JSON.parse(raw)));
    expect(recovery).toHaveLength(1);
    expect(recovery[0].base.editVersion).toBe(original.edit_version);
    expect((await json(["memory", "fact-list", "--for-editing"]))[0].value).toBe("blue before repaint");
    await card.screenshot({ path: testInfo.outputPath("stale-canon-correction.png"), animations: "disabled" });

    await card.getByRole("button", { name: "Keep correction after reviewing saved fact" }).click();
    await card.getByRole("button", { name: "Save fact correction" }).click();
    await expect(card.getByRole("button", { name: "Correct or withdraw fact" })).toBeVisible();
    const saved = (await json(["memory", "fact-list", "--for-editing"]))[0];
    expect(saved.value).toBe("green");
    expect(saved.evidence[0].excerpt).toBe("The gate was green.");
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("openauthor.canonCorrection.v1:")))).toEqual([]);
    expect((await json(["scene", "get", "--id", "scene-0001"])).body).toBe(body + "\n");
    await card.getByRole("button", { name: "Correct or withdraw fact" }).click();
    await card.getByRole("textbox", { name: "Value", exact: true }).fill("unfinished next correction");
    await card.getByRole("button", { name: "Cancel correction" }).click();
    await page.reload();
    await page.getByText("Add or update story records", { exact: true }).click();
    await expect(card.getByRole("button", { name: "Correct or withdraw fact" })).toBeVisible();
    await expect(card.getByRole("textbox", { name: "Value", exact: true })).toHaveCount(0);
    expect((await json(["memory", "fact-list", "--for-editing"]))[0].value).toBe("green");

    // Delay delivery after the real core has committed the correction. Another
    // writer can update and refresh the fact before that older reply arrives.
    await page.evaluate(() => {
      const host = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, payload: any) => Promise<any> }; __canonSaveCommitted?: boolean; __releaseCanonSave?: () => void };
      const invoke = host.__TAURI_INTERNALS__.invoke;
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      host.__releaseCanonSave = release;
      let intercepted = false;
      host.__TAURI_INTERNALS__.invoke = async (command, payload) => {
        const result = await invoke(command, payload);
        if (!intercepted && command === "core_command" && payload.args?.[0] === "memory" && payload.args?.[1] === "fact-update") {
          intercepted = true; host.__canonSaveCommitted = true;
          await gate;
        }
        return result;
      };
    });
    await card.getByRole("button", { name: "Correct or withdraw fact" }).click();
    await card.getByRole("textbox", { name: "Value", exact: true }).fill("green after repaint");
    await card.getByRole("button", { name: "Save fact correction" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __canonSaveCommitted?: boolean }).__canonSaveCommitted)).toBe(true);
    const committed = (await json(["memory", "fact-list", "--for-editing"]))[0];
    expect(committed.value).toBe("green after repaint");
    await json(["memory", "fact-update", "--id", added.id, "--expected-version", committed.edit_version, "--changes-json", JSON.stringify({ value: "author revised the saved fact again" })]);
    await page.getByRole("button", { name: "Run Diagnostics", exact: true }).click();
    await expect(card.getByText("author revised the saved fact again", { exact: true })).toBeVisible();
    await page.evaluate(() => (window as unknown as { __releaseCanonSave: () => void }).__releaseCanonSave());
    await expect(card.getByText(/The correction was saved, and a newer saved fact is now available/)).toBeVisible();
    await expect(card.getByRole("textbox", { name: "Value", exact: true })).toHaveValue("green after repaint");
    await expect(card.getByRole("button", { name: "Save fact correction" })).toBeDisabled();
    expect((await json(["memory", "fact-list", "--for-editing"]))[0].value).toBe("author revised the saved fact again");
    const retained = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("openauthor.canonCorrection.v1:")).map(([, raw]) => JSON.parse(raw)));
    expect(retained).toHaveLength(1);
    expect(retained[0].base.editVersion).toBe(saved.edit_version);
    expect(retained[0].value.changes.value).toBe("green after repaint");
    await card.getByRole("button", { name: "Cancel correction" }).click();
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("openauthor.canonCorrection.v1:")))).toEqual([]);
    expect(book.errors).toEqual([]);
  } finally { await book.close(); }
});
