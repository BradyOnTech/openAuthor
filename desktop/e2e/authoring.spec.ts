import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Only the native transport is adapted. Every manuscript operation runs the real
// Python CLI against a disposable project; no manuscript/proposal responses are
// synthesized. This complements, and does not certify, the native Tauri bridge.
test("writes, focuses, reviews an AI revision, undoes it, and reopens the saved manuscript", async ({ page }, testInfo) => {
  const sandbox = await realpath(await mkdtemp(join(tmpdir(), "openauthor-browser-")));
  const projectRoot = join(sandbox, "The Lantern Cartographer");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const pending = new Set<Promise<unknown>>();
  let completedSceneWrites = 0;

  function scopedPath(path: string) {
    const candidate = resolve(path === "." || !path ? sandbox : path);
    const local = relative(sandbox, candidate);
    if (local.startsWith("..") || isAbsolute(local)) throw new Error("Browser test tried to leave its disposable project.");
    return candidate;
  }

  async function core(root: string, args: string[]) {
    const cwd = scopedPath(root);
    await mkdir(cwd, { recursive: true });
    try {
      const result = await exec(process.env.OPENAUTHOR_TEST_PYTHON || "python3", ["-m", "openauthor", ...args], {
        cwd,
        env: { ...process.env, PYTHONPATH: repository, OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" },
        timeout: 20_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      return { status: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      return { status: typeof failure.code === "number" ? failure.code : 1, stdout: failure.stdout || "", stderr: failure.stderr || String(error) };
    } finally {
      if (args[0] === "scene" && args[1] === "update") completedSceneWrites += 1;
    }
  }

  try {
    await page.exposeBinding("__openauthorTestInvoke", async (_source, command: string, payload: { projectRoot?: string; args?: string[] }) => {
      if (command === "project_status") {
        const root = scopedPath(payload.projectRoot || ".");
        const result = await core(root, ["project", "inspect", "--json"]);
        return { found: result.status === 0, project_root: root };
      }
      if (command !== "core_command") throw new Error(`Native-only command unavailable in browser CLI test: ${command}`);
      const args = payload.args || [];
      if (args[0] === "init") scopedPath(args[1]);
      const providerIndex = args.indexOf("--provider");
      if (providerIndex >= 0 && args[providerIndex + 1] !== "local") throw new Error("Browser smoke tests use only the offline local provider.");
      const request = core(payload.projectRoot || ".", args);
      pending.add(request);
      try { return await request; } finally { pending.delete(request); }
    });
    await page.addInitScript(() => {
      const host = window as unknown as { __TAURI_INTERNALS__: unknown; __openauthorTestInvoke: (command: string, payload: unknown) => Promise<unknown> };
      host.__TAURI_INTERNALS__ = { invoke: (command: string, payload: unknown) => host.__openauthorTestInvoke(command, payload) };
    });
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Lantern Cartographer");
    await page.getByRole("textbox", { name: "Project folder" }).fill(projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await page.getByPlaceholder("New scene title...").fill("The Moving Map");
    await page.getByRole("button", { name: "Add Scene", exact: true }).click();

    const prose = page.getByRole("textbox", { name: "Scene prose" });
    const original = "Mara unrolled the map beside the lamp. A red line crept across the paper, passing streets the city had forgotten. She locked the door and watched it move.\n\nAt midnight, the line reached her own door.";
    await prose.fill(original);
    await prose.press("Control+Shift+Z");
    await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeVisible();
    await expect(prose).toHaveValue(original);
    await page.screenshot({ path: testInfo.outputPath("focus-mode.png"), animations: "disabled" });
    await prose.press("Escape");
    await expect(page.getByRole("button", { name: "Exit focus mode" })).toHaveCount(0);
    await prose.press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("writing.png") });

    await page.getByRole("button", { name: /^Changes \(/ }).click();
    await page.getByTitle("Create a reviewable Change Set").click();
    await page.getByPlaceholder(/Tighten the pacing/).fill("Make the final paragraph more ominous while preserving all names, facts, and events.");
    await page.getByRole("combobox", { name: /^Provider/ }).selectOption("local");
    await page.getByRole("button", { name: "Create Change Set", exact: true }).click();
    await expect(page.getByRole("button", { name: "Apply 1 change", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("change-review.png") });
    await page.getByRole("button", { name: "Apply 1 change", exact: true }).click();
    await expect(page.getByRole("button", { name: "Undo change", exact: true })).toBeVisible();

    const revised = JSON.parse((await core(projectRoot, ["scene", "get", "--id", "scene-0001", "--json"])).stdout);
    expect(revised.body.trimEnd()).toBe(original.replace("reached her own door", "found her own door"));
    await page.getByRole("button", { name: "Undo change", exact: true }).click();
    await expect(prose).toHaveValue(original + "\n");
    const restored = JSON.parse((await core(projectRoot, ["scene", "get", "--id", "scene-0001", "--json"])).stdout);
    expect(restored.body.trimEnd()).toBe(original);
    await page.reload();
    await page.getByRole("button", { name: /^Manuscript \(/ }).click();
    await expect(prose).toHaveValue(original + "\n");

    // A second writer changes the persisted scene after this editor loaded it.
    // Saving this older draft must preserve that write and offer reconciliation.
    const elsewhere = "Mara followed the line to a door that had never existed.";
    const localDraft = "Mara hid the moving map beneath the floorboards.";
    const independentSave = await core(projectRoot, ["scene", "update", "--id", "scene-0001", "--body", elsewhere, "--json"]);
    expect(independentSave.status).toBe(0);
    const expectedWrites = completedSceneWrites + 1;
    await prose.fill(localDraft);
    await prose.press("Control+s");
    await expect.poll(() => completedSceneWrites).toBe(expectedWrites);
    const afterConflict = JSON.parse((await core(projectRoot, ["scene", "get", "--id", "scene-0001", "--json"])).stdout);
    expect(afterConflict.body.trimEnd()).toBe(elsewhere);
    await expect(page.getByRole("heading", { name: "Scene changed elsewhere" })).toBeVisible();
    await expect(prose).toHaveValue(localDraft);
    await page.screenshot({ path: testInfo.outputPath("scene-conflict.png") });
    // Reopening and restoring must retain the OLD precondition, not treat the
    // newest on-disk scene as permission to overwrite it with recovered text.
    await page.reload();
    await page.getByRole("button", { name: /^Manuscript \(/ }).click();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await prose.press("Control+s");
    await expect(page.getByRole("heading", { name: "Scene changed elsewhere" })).toBeVisible();
    await expect(prose).toHaveValue(localDraft);
    const resolution = "Mara hid the moving map beneath the floorboards, then followed its line to the impossible door.";
    await prose.fill(resolution);
    // The reviewed comparison can itself become stale. Guard the deliberate
    // resolution too, and never turn this button into an unconditional force.
    const third = "Mara burned the map before the impossible door could open.";
    expect((await core(projectRoot, ["scene", "update", "--id", "scene-0001", "--body", third, "--json"])).status).toBe(0);
    await page.getByRole("button", { name: "Save reconciled version" }).click();
    await expect(page.getByRole("textbox", { name: "Saved prose" })).toHaveValue(third + "\n");
    await expect(prose).toHaveValue(resolution);
    await page.getByRole("button", { name: "Save reconciled version" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const reconciled = JSON.parse((await core(projectRoot, ["scene", "get", "--id", "scene-0001", "--json"])).stdout);
    expect(reconciled.body.trimEnd()).toBe(resolution);
    await page.reload();
    await page.getByRole("button", { name: /^Manuscript \(/ }).click();
    await expect(prose).toHaveValue(resolution + "\n");
    await expect(page.getByRole("button", { name: "Restore", exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    if (!page.isClosed()) await page.screenshot({ path: testInfo.outputPath("last-screen.png") }).catch(() => {});
    await page.close();
    await Promise.allSettled([...pending]);
    await rm(sandbox, { recursive: true, force: true });
  }
});
