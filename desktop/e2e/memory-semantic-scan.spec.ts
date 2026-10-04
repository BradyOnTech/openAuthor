import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { localBook } from "./localBook";

const exec = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("reviews exact Memory scan sources on a laptop before queuing local suggestions, with stale and busy guards", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const book = await localBook(page);
  const fixtureEnv = { ...process.env, PYTHONPATH: repository, OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "", OPENAUTHOR_CODEX_HOME: join(book.sandbox, "codex") };
  async function fixture(script: string) {
    await exec(process.env.OPENAUTHOR_TEST_PYTHON || "python3", ["-c", script], { cwd: book.projectRoot, env: fixtureEnv });
  }
  async function json(args: string[]) {
    const result = await book.core(book.projectRoot, [...args, "--json"]);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  }
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Reviewed Harbor");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await expect(page.getByRole("button", { name: "Add Scene", exact: true })).toBeVisible();
    // Public core fixture creation leaves the suggestion queue cold. All prose
    // is original synthetic material in localBook's disposable directory.
    await fixture("from pathlib import Path\nfrom openauthor.project import resolve_project\nfrom openauthor.scenes import add_scene\np=resolve_project(Path.cwd())\nfor i in range(30):\n  body=('Mara waits by the rope. Ivo watches Mara. Ivo keeps the lantern. 小林来了。\\n\\n' + 'The tide moved under the pier; the rope stayed dry.\\n' * 55 + 'Exact final line '+str(i+1)) if i<6 else 'UNREVIEWED-SOURCE '+str(i+1)\n  add_scene(p,title='Harbor scene '+str(i+1),body=body)\n");
    const original = await json(["scene", "list"]);
    const sourceBodies = await Promise.all(original.slice(0, 6).map((scene: { id: string }) => json(["scene", "get", "--id", scene.id])));
    expect(await json(["memory", "list"])).toEqual([]);
    await page.reload();
    await page.getByRole("button", { name: "Hide first-run guide" }).click();
    await page.getByRole("button", { name: "Story Memory (Cmd+Shift+X)" }).click();
    await page.getByRole("button", { name: "Review Memory suggestions", exact: true }).click();
    const inbox = page.getByRole("region", { name: "Memory suggestion review" });
    const scan = inbox.getByRole("region", { name: "Reviewed AI Memory scan" });
    await page.setViewportSize({ width: 1024, height: 768 });
    await scan.getByRole("button", { name: "Review AI scan" }).click();
    const close = scan.getByRole("button", { name: "Close scan review" });
    await expect(close).toBeInViewport();
    expect(await scan.getByRole("group", { name: "Scenes to scan" }).evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await scan.getByRole("combobox", { name: "Scan provider" }).selectOption("local");
    for (let index = 1; index <= 6; index++) await scan.getByRole("checkbox", { name: `Harbor scene ${index}`, exact: true }).check();
    await expect(scan.getByRole("checkbox", { name: "Harbor scene 7", exact: true })).toBeDisabled();
    await scan.getByRole("button", { name: "Preview scan sources" }).click();
    const sources = scan.getByLabel("Exact scan sources");
    await expect(sources.locator("article")).toHaveCount(6);
    for (const source of sourceBodies) expect(await sources.locator("article").filter({ has: page.getByRole("heading", { name: source.title, exact: true }) }).locator("pre").textContent()).toBe(source.body);
    await expect(sources).not.toContainText("UNREVIEWED-SOURCE");
    expect(await json(["memory", "list"])).toEqual([]);
    const send = scan.getByRole("button", { name: "Run reviewed local scan" });
    await expect(send).toBeInViewport();
    await expect(close).toBeInViewport();
    expect(await scan.getByRole("region", { name: "Memory scan scope and source passages" }).evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await sources.locator("article").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("memory-scan-exact-sources-laptop.png"), animations: "disabled" });
    await scan.getByRole("region", { name: "Memory scan scope and source passages" }).evaluate(node => { node.scrollTop = node.scrollHeight; });
    await sources.locator("article").last().locator("pre").evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect(send).toBeInViewport();
    await expect(close).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("memory-scan-final-source-laptop.png"), animations: "disabled" });

    // A controlled browser transport pause tests the real UI's busy guard;
    // release continues to the actual provider-free Python CLI, once only.
    await page.evaluate(() => {
      const host = window as unknown as Record<string, any>;
      const originalInvoke = host.__TAURI_INTERNALS__.invoke;
      host.__memoryScanCalls = 0;
      host.__TAURI_INTERNALS__.invoke = async (command: string, payload: any) => {
        if (command === "core_command" && payload.args?.[0] === "memory" && payload.args?.[1] === "scan-ai") {
          host.__memoryScanCalls++;
          await new Promise<void>(release => { host.__releaseMemoryScan = release; });
        }
        return originalInvoke(command, payload);
      };
    });
    await send.click();
    await expect(scan.getByText(/cannot be interrupted here/)).toBeVisible();
    await expect(close).toBeDisabled();
    await expect(send).toBeDisabled();
    await expect(inbox.getByRole("button", { name: "Scan manuscript", exact: true })).toBeDisabled();
    await page.evaluate(() => (window as unknown as { __releaseMemoryScan: () => void }).__releaseMemoryScan());
    await expect(scan.getByText(/await review\. Suggestions remain unconfirmed/)).toHaveCount(1);
    const queued = await json(["memory", "list"]);
    expect(queued.length).toBeGreaterThan(0);
    expect(queued.every((row: { status: string }) => row.status === "pending")).toBe(true);
    expect(await json(["codex", "list"])).toEqual([]);
    expect(await json(["memory", "fact-list"])).toEqual([]);
    for (const source of sourceBodies) expect((await json(["scene", "get", "--id", source.id])).body).toBe(source.body);
    expect(await page.evaluate(() => (window as unknown as { __memoryScanCalls: number }).__memoryScanCalls)).toBe(1);
    await close.click();
    await expect(inbox.getByRole("button", { name: "Refresh suggestions" })).toBeInViewport();
    await scan.getByRole("button", { name: "Review AI scan" }).click();
    await expect(scan.getByRole("checkbox", { name: "Harbor scene 1", exact: true })).toBeChecked();
    await expect(scan.getByRole("button", { name: "Run reviewed local scan" })).toHaveCount(0);
    await scan.getByRole("button", { name: "Preview scan sources" }).click();
    await expect(sources.locator("article")).toHaveCount(6);
    await fixture("from pathlib import Path\nfrom openauthor.project import resolve_project\nfrom openauthor.scenes import update_scene\nupdate_scene(resolve_project(Path.cwd()),scene_identifier='scene-0001',body='The saved source has changed. 小林留下了信。')\n");
    const beforeStale = await json(["memory", "list"]);
    await send.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __memoryScanCalls: number }).__memoryScanCalls)).toBe(2);
    await page.evaluate(() => (window as unknown as { __releaseMemoryScan: () => void }).__releaseMemoryScan());
    await expect(scan.getByRole("alert")).toContainText(/changed|stale|review/i);
    await expect(send).toHaveCount(0);
    await expect(scan.getByRole("checkbox", { name: "Harbor scene 1", exact: true })).toBeChecked();
    expect(await json(["memory", "list"])).toEqual(beforeStale);
    expect(await json(["codex", "list"])).toEqual([]);
    expect(await json(["memory", "fact-list"])).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("memory-scan-stale-scope-laptop.png"), animations: "disabled" });
    expect(book.errors).toEqual([]);
  } finally { await book.close(); }
});
