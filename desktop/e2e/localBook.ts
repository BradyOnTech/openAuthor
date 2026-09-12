import type { Page } from "@playwright/test";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Browser-only transport adapter. Both command results and Assistant events
// come from the real Python core, using a disposable book and offline provider.
export async function localBook(page: Page) {
  const sandbox = await realpath(await mkdtemp(join(tmpdir(), "openauthor-journey-")));
  const projectRoot = join(sandbox, "The Lantern Cartographer");
  const env = { ...process.env, PYTHONPATH: repository, OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" };
  const python = process.env.OPENAUTHOR_TEST_PYTHON || "python3";
  const pending = new Set<Promise<unknown>>();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));

  function scopedPath(path: string) {
    const candidate = resolve(path === "." || !path ? sandbox : path);
    const local = relative(sandbox, candidate);
    if (local.startsWith("..") || isAbsolute(local)) throw new Error("Author journey tried to leave its disposable sandbox.");
    return candidate;
  }

  async function core(root: string, args: string[]) {
    const cwd = scopedPath(root);
    await mkdir(cwd, { recursive: true });
    const provider = args.indexOf("--provider");
    if (provider >= 0 && args[provider + 1] !== "local") throw new Error("Only the offline provider is allowed.");
    if (args[0] === "init") scopedPath(args[1]);
    for (const option of args[0] === "manuscript" ? ["--source", "--target"] : []) {
      const index = args.indexOf(option);
      if (index >= 0) scopedPath(args[index + 1]);
    }
    try {
      const result = await exec(python, ["-m", "openauthor", ...args], { cwd, env, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
      return { status: 0, ...result };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      return { status: failure.code || 1, stdout: failure.stdout || "", stderr: failure.stderr || String(error) };
    }
  }

  async function sidecar(root: string, request: { id: string; method: string; params: Record<string, unknown> }) {
    const cwd = scopedPath(root);
    // Each request uses a fresh stdio process; this tests protocol/UI wiring,
    // not the native bridge's persistent-process lifecycle or interruption.
    return new Promise((resolveRequest, reject) => {
      const child = spawn(python, ["-m", "openauthor", "serve"], { cwd, env });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill(), 20_000);
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("close", async code => {
        clearTimeout(timer);
        try {
          if (code !== 0) throw new Error(stderr || `Sidecar exited ${code}`);
          const frames = stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
          for (const frame of frames.filter(frame => frame.event)) {
            await page.evaluate(({ projectRoot: root, frame }) => {
              (window as unknown as { __emitSidecar: (value: unknown) => void }).__emitSidecar({ projectRoot: root, frame });
            }, { projectRoot: root, frame });
          }
          const response = frames.find(frame => frame.id === request.id);
          if (!response) throw new Error("Sidecar did not return a response.");
          resolveRequest(response);
        } catch (error) { reject(error); }
      });
      child.stdin.end(JSON.stringify(request) + "\n");
    });
  }

  await page.exposeBinding("__openauthorTestInvoke", async (_source, command: string, payload) => {
    const root = scopedPath(payload.projectRoot || ".");
    const request = (async () => {
      if (command === "project_status") {
        const result = await core(root, ["project", "inspect", "--json"]);
        return { found: result.status === 0, project_root: root };
      }
      if (command === "core_command") return core(root, payload.args || []);
      if (command === "sidecar_request") return sidecar(root, payload.request);
      throw new Error(`Native command not covered by the author journey: ${command}`);
    })();
    pending.add(request);
    try { return await request; } finally { pending.delete(request); }
  });
  await page.addInitScript(() => {
    const host = window as unknown as Record<string, any>;
    let nextId = 0;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    host.__TAURI_INTERNALS__ = {
      transformCallback: (callback: (event: unknown) => void) => { const id = ++nextId; callbacks.set(id, callback); return id; },
      invoke: (command: string, payload: any) => {
        if (command === "plugin:event|listen") { const id = ++nextId; listeners.set(id, payload); return Promise.resolve(id); }
        if (command === "plugin:event|unlisten") { listeners.delete(payload.eventId); return Promise.resolve(); }
        return host.__openauthorTestInvoke(command, payload);
      },
    };
    host.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    host.__emitSidecar = (payload: unknown) => {
      for (const [id, listener] of listeners) {
        if (listener.event === "openauthor://sidecar-event") callbacks.get(listener.handler)?.({ id, event: listener.event, payload });
      }
    };
  });
  return {
    sandbox, projectRoot, core, errors,
    async close() {
      await page.close();
      await Promise.allSettled([...pending]);
      await rm(sandbox, { recursive: true, force: true });
    },
  };
}
