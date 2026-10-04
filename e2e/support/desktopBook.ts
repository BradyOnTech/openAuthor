import type { Browser } from "@e2e-dev/web";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const routePattern = "**/*";

// Adapt the native transport, preserving the real core and rendered product.
// The route injects setup into the real Vite document because the pinned e2e
// web package has no addInitScript or exposeBinding API.
export async function desktopBook(browser: Browser) {
  const sandbox = await realpath(await mkdtemp(join(tmpdir(), "openauthor-tester-army-")));
  const projectRoot = join(sandbox, "The Lantern Cartographer");
  const profile = join(sandbox, "profile");
  const temporary = join(sandbox, "tmp");
  await Promise.all([mkdir(profile), mkdir(temporary)]);
  const env = {
    PATH: process.env.PATH,
    HOME: profile,
    TMPDIR: temporary,
    LANG: "en_US.UTF-8",
    PYTHONPATH: repository,
    PYTHONDONTWRITEBYTECODE: "1",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENROUTER_API_KEY: "",
    OPENAUTHOR_CODEX_HOME: join(profile, "codex"),
  };
  const python = process.env.OPENAUTHOR_TEST_PYTHON || "python3";
  const pending = new Set<Promise<unknown>>();
  let closed = false;

  function scopedPath(path: string) {
    const candidate = resolve(path === "." || !path ? sandbox : path);
    const local = relative(sandbox, candidate);
    if (local.startsWith("..") || isAbsolute(local)) throw new Error("The desktop journey attempted to leave its disposable project.");
    return candidate;
  }

  async function core(root: string, args: string[]) {
    const cwd = scopedPath(root);
    await mkdir(cwd, { recursive: true });
    const providerIndex = args.indexOf("--provider");
    if (providerIndex >= 0 && args[providerIndex + 1] !== "local") throw new Error("Desktop journeys allow only the offline provider.");
    const requestIndex = args.indexOf("--request-json");
    if (requestIndex >= 0) {
      const provider = JSON.parse(args[requestIndex + 1]).provider;
      if (provider && provider !== "local") throw new Error("Desktop journeys allow only the offline provider.");
    }
    if (args[0] === "init") scopedPath(args[1]);
    if (["manuscript", "backup"].includes(args[0])) {
      for (const flag of ["--source", "--target"]) {
        const index = args.indexOf(flag);
        if (index >= 0) scopedPath(args[index + 1]);
      }
    }
    try {
      const result = await execute(python, ["-m", "openauthor", ...args], { cwd, env, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
      return { status: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      return { status: typeof failure.code === "number" ? failure.code : 1, stdout: failure.stdout || "", stderr: failure.stderr || String(error) };
    }
  }

  async function json(args: string[], root = projectRoot) {
    const result = await core(root, [...args, "--json"]);
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Core command failed.");
    return JSON.parse(result.stdout);
  }

  async function sidecar(root: string, request: { id: string; params?: { provider?: string } }) {
    const cwd = scopedPath(root);
    if (request.params?.provider && request.params.provider !== "local") throw new Error("Desktop journeys allow only the offline provider.");
    return new Promise<{ response: unknown; events: unknown[] }>((resolveRequest, reject) => {
      const child = spawn(python, ["-m", "openauthor", "serve"], { cwd, env });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill(), 30_000);
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("close", code => {
        clearTimeout(timer);
        try {
          if (code !== 0) throw new Error(stderr || `Sidecar exited ${code}.`);
          const frames = stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
          const response = frames.find(frame => frame.id === request.id);
          if (!response) throw new Error("Sidecar returned no request response.");
          resolveRequest({ response, events: frames.filter(frame => frame.event).map(frame => ({ projectRoot: root, frame })) });
        } catch (error) { reject(error); }
      });
      child.stdin.end(JSON.stringify(request) + "\n");
    });
  }

  const setup = `<script>(() => {
    const errors = []; window.__openauthorE2eErrors = errors;
    window.addEventListener('error', event => errors.push(event.message));
    window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
    let nextId = 0;
    const callbacks = new Map(); const listeners = new Map();
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) { const id = ++nextId; callbacks.set(id, callback); return id; },
      async invoke(command, payload) {
        if (command === 'plugin:event|listen') { const id = ++nextId; listeners.set(id, payload); return id; }
        if (command === 'plugin:event|unlisten') { listeners.delete(payload.eventId); return; }
        const response = await fetch('/__openauthor_e2e_invoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command, payload }) });
        const result = await response.json();
        if (result.error) throw new Error(result.error);
        for (const event of result.events || []) for (const [id, listener] of listeners) {
          if (listener.event === 'openauthor://sidecar-event') callbacks.get(listener.handler)?.({ id, event: listener.event, payload: event });
        }
        return result.value;
      }
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  })();</script>`;

  await browser.route(routePattern, async route => {
    const url = new URL(route.request.url);
    if (!(["127.0.0.1", "localhost"].includes(url.hostname))) return route.continue();
    if (url.pathname === "/__openauthor_e2e_invoke") {
      const request = (async () => {
        if (closed) throw new Error("The disposable desktop project is closed.");
        const { command, payload = {} } = JSON.parse(route.request.postData || "{}");
        const root = scopedPath(payload.projectRoot || ".");
        if (command === "project_status") {
          const result = await core(root, ["project", "inspect", "--json"]);
          return { value: { found: result.status === 0, project_root: root } };
        }
        if (command === "core_command") return { value: await core(root, payload.args || []) };
        if (command === "sidecar_request") {
          const { response, events } = await sidecar(root, payload.request);
          return { value: response, events };
        }
        throw new Error(`Native-only command is not supported by this browser journey: ${command}`);
      })();
      pending.add(request);
      try { await route.fulfill({ body: JSON.stringify(await request), headers: { "content-type": "application/json" } }); }
      catch (error) { await route.fulfill({ body: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), headers: { "content-type": "application/json" } }); }
      finally { pending.delete(request); }
      return;
    }
    if (route.request.method === "GET" && route.request.headers.accept?.includes("text/html")) {
      const response = await fetch(url);
      const html = await response.text();
      if (!html.includes("<head>")) throw new Error("Expected the real desktop HTML document.");
      await route.fulfill({ status: response.status, body: html.replace("<head>", `<head>${setup}`), headers: { "content-type": "text/html" } });
      return;
    }
    await route.continue();
  });

  return {
    sandbox, projectRoot, core, json,
    async errors() { return browser.evaluate(() => (window as unknown as { __openauthorE2eErrors: string[] }).__openauthorE2eErrors); },
    async close() {
      closed = true;
      await Promise.allSettled([...pending]);
      await browser.unroute(routePattern);
      await rm(sandbox, { recursive: true, force: true });
    },
  };
}
