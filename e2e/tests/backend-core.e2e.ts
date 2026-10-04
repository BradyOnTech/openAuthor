import { test, expect } from "e2e";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMobileSnapshotManifest } from "../../contracts/src/index.ts";
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const python = process.env.OPENAUTHOR_TEST_PYTHON || "python3";

async function book() {
  const sandbox = await realpath(await mkdtemp(join(tmpdir(), "openauthor-backend-e2e-")));
  const root = join(sandbox, "book");
  const env = {
    PATH: process.env.PATH,
    PYTHONPATH: repository,
    PYTHONDONTWRITEBYTECODE: "1",
    OPENAUTHOR_CODEX_HOME: join(sandbox, "subscription-profile"),
    OPENAUTHOR_PROVIDER_MAX_RETRIES: "0",
  };
  async function raw(args: string[], cwd = root, input?: string) {
    try {
      const options = { cwd, env, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 };
      // execFile has no stdin option. A sidecar receives complete newline frames
      // through its actual process stdin, preserving one process for the batch.
      const child = execFile(python, ["-m", "openauthor", ...args], options);
      if (input !== undefined) child.stdin!.end(input);
      const result = await new Promise<{ stdout: string; stderr: string }>((resolveResult, reject) => {
        let stdout = "";
        let stderr = "";
        child.stdout!.on("data", chunk => { stdout += chunk; });
        child.stderr!.on("data", chunk => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", code => code === 0 ? resolveResult({ stdout, stderr }) : reject({ code, stdout, stderr }));
      });
      return { status: 0, ...result };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      return { status: failure.code || 1, stdout: failure.stdout || "", stderr: failure.stderr || String(error) };
    }
  }
  async function cli(args: string[], cwd = root): Promise<any> {
    const result = await raw([...args, "--json"], cwd);
    expect({ status: result.status, error: result.stderr }).toEqual({ status: 0, error: "" });
    return JSON.parse(result.stdout);
  }
  const initialized = await raw(["init", root, "--name", "The Winter Gate", "--project-id", "project-backend-e2e", "--json"], sandbox);
  expect(initialized.status).toBe(0);
  return {
    sandbox, root, raw, cli,
    async sidecar(frames: string[]) {
      const result = await raw(["serve"], root, `${frames.join("\n")}\n`);
      expect({ status: result.status, error: result.stderr }).toEqual({ status: 0, error: "" });
      return result.stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    },
    async close() { await rm(sandbox, { recursive: true, force: true }); },
  };
}

test("backend: reviewed import refuses changed source and exports saved chapter prose", { timeout: 60_000 }, async () => {
  const f = await book();
  try {
    const source = join(f.sandbox, "novel.md");
    const manuscript = "# Opening\n\nMara guards the winter gate.\n\n# Return\n\nThe gate opens at dawn.\n";
    await writeFile(source, manuscript);
    const preview = await f.cli(["manuscript", "preview", "--source", source]);
    await writeFile(source, `${manuscript}\nThe old key turns.\n`);
    const refused = await f.raw(["manuscript", "import", "--source", source, "--expected-fingerprint", preview.fingerprint, "--json"]);
    expect(refused.status).toBe(2);
    expect(await f.cli(["scene", "list"])).toHaveLength(0);
    await writeFile(source, manuscript);
    await f.cli(["manuscript", "import", "--source", source, "--expected-fingerprint", preview.fingerprint]);
    const scenes = await f.cli(["scene", "list"]);
    expect(scenes.map((row: any) => row.title)).toEqual(["Opening", "Return"]);
    const reading = await f.cli(["manuscript", "read"]);
    expect(JSON.stringify(reading)).toContain("Mara guards the winter gate.");
    const exported = await f.cli(["manuscript", "export", "--format", "markdown", "--target", join(f.sandbox, "export")]);
    expect(JSON.stringify(exported)).toContain("markdown");
    const reread = await f.cli(["manuscript", "preview", "--source", join(f.sandbox, "export")]);
    expect(JSON.stringify(reread)).toContain("Opening");
  } finally { await f.close(); }
});

test("backend: stale editor save preserves newer prose and its recoverable conflict", { timeout: 60_000 }, async () => {
  const f = await book();
  try {
    await f.cli(["scene", "add", "--title", "Gate", "--body", "The gate is blue."]);
    const loaded = await f.cli(["scene", "get", "--id", "scene-0001"]);
    await f.cli(["scene", "update", "--id", loaded.id, "--body", "The gate is green.", "--expected-version", JSON.stringify(loaded.edit_version)]);
    const stale = await f.raw(["scene", "update", "--id", loaded.id, "--body", "The gate is red.", "--expected-version", JSON.stringify(loaded.edit_version), "--json"]);
    expect(stale.status).toBe(3);
    const conflict = JSON.parse(stale.stdout).error;
    expect(conflict.message).toContain("changed");
    expect((await f.cli(["scene", "get", "--id", loaded.id])).body).toBe("The gate is green.\n");
    const recovered = JSON.parse(await readFile(join(f.root, conflict.recovery_path), "utf8"));
    expect(recovered.draft.body).toBe("The gate is red.");
  } finally { await f.close(); }
});

test("backend: individual budget limits clear while unrelated limits remain enforced", { timeout: 60_000 }, async () => {
  const f = await book();
  try {
    await f.cli(["generation", "budget", "--max-input-tokens", "100", "--max-output-tokens", "200", "--daily-tokens", "900"]);
    const cleared = await f.cli(["generation", "budget", "--clear-limit", "max_input_tokens", "--clear-limit", "max_output_tokens", "--weekly-tokens", "3000"]);
    expect(cleared.policy.per_run.max_input_tokens).toBeNull();
    expect(cleared.policy.per_run.max_output_tokens).toBeNull();
    expect(cleared.policy.rolling.daily_tokens).toBe(900);
    expect(cleared.policy.rolling.weekly_tokens).toBe(3000);
    for (const args of [
      ["--clear-limit", "daily_tokens", "--daily-tokens", "100"],
      ["--clear-limit", "unknown_limit"],
      ["--reset", "--clear-limit", "daily_tokens"],
      ["--max-estimated-cost-usd", "nan"],
      ["--daily-estimated-cost-usd", "inf"],
      ["--max-estimated-cost-usd", "0.000000001"],
    ]) {
      expect((await f.raw(["generation", "budget", ...args, "--json"])).status).toBe(2);
      expect((await f.cli(["generation", "budget"])).policy).toEqual(cleared.policy);
    }
  } finally { await f.close(); }
});

test("backend: malformed stored budget values fail safely without rewriting the policy", { timeout: 60_000 }, async () => {
  const f = await book();
  try {
    await f.cli(["scene", "add", "--title", "Gate", "--body", "The gate stays closed."]);
    const baseline = (await f.cli(["generation", "budget"])).policy;
    const path = join(f.root, ".openauthor", "generation_budget_policy.json");
    const invalid = [
      `{"per_run":{"max_input_tokens":${"[".repeat(1500)}1${"]".repeat(1500)}}}`,
      "[]",
      "null",
      JSON.stringify({ ...baseline, per_run: "corrupt" }),
      JSON.stringify({ ...baseline, rolling: [] }),
      JSON.stringify({ ...baseline, per_run: { ...baseline.per_run, max_estimated_cost_usd: "oversized" } }).replace('"oversized"', `1${"0".repeat(1000)}`),
      JSON.stringify({ ...baseline, per_run: { ...baseline.per_run, max_estimated_cost_usd: "oversized" } }).replace('"oversized"', `1${"0".repeat(5000)}`),
      JSON.stringify({ ...baseline, per_run: { ...baseline.per_run, max_estimated_cost_usd: 0.000000001 } }),
      JSON.stringify({ ...baseline, per_run: { ...baseline.per_run, max_input_tokens: 1.5 } }),
    ];
    for (const text of invalid) {
      await writeFile(path, text);
      const refused = await f.raw(["proposal", "generate", "--scene", "scene-0001", "--instruction", "Tighten the pacing.", "--provider", "local", "--json"]);
      expect(refused.status).toBe(2);
      expect(refused.stderr).not.toContain("Traceback");
      const result = await f.raw(["generation", "budget", "--json"]);
      expect(result.status).toBe(2);
      expect(result.stderr).not.toContain("Traceback");
      expect(await readFile(path, "utf8")).toBe(text);
      expect(await f.cli(["generation", "list"])).toEqual([]);
      expect(await f.cli(["proposal", "list"])).toEqual([]);
      expect((await f.cli(["scene", "get", "--id", "scene-0001"])).body).toBe("The gate stays closed.\n");
      expect((await f.cli(["generation", "budget", "--reset"])).policy).toEqual(baseline);
    }
    await rm(path);
    expect((await f.cli(["generation", "budget"])).policy).toEqual(baseline);
  } finally { await f.close(); }
});

test("backend: local proposal delivery is replay safe, reviewed before apply and undoable", { timeout: 60_000 }, async () => {
  const f = await book();
  try {
    await f.cli(["scene", "add", "--title", "Gate", "--body", "The gate is very blue. Mara really waits."]);
    const generate = ["proposal", "generate", "--scene", "scene-0001", "--instruction", "Tighten the pacing.", "--provider", "local", "--request-id", "proposal-e2e-delivery"];
    const first = await f.cli(generate);
    const replay = await f.cli(generate);
    expect(replay.id).toBe(first.id);
    expect(await f.cli(["proposal", "list"])).toHaveLength(1);
    const drafted = await f.cli(["proposal", "draft", "--id", first.id, "--provider", "local", "--request-id", "draft-e2e-delivery"]);
    expect(JSON.stringify(drafted)).toContain("proposed_body");
    expect((await f.cli(["scene", "get", "--id", "scene-0001"])).body).toBe("The gate is very blue. Mara really waits.\n");
    await f.cli(["proposal", "apply", "--id", first.id]);
    expect((await f.cli(["proposal", "get", "--id", first.id])).status).toBe("applied");
    await f.cli(["proposal", "undo", "--id", first.id]);
    expect((await f.cli(["scene", "get", "--id", "scene-0001"])).body).toBe("The gate is very blue. Mara really waits.\n");
  } finally { await f.close(); }
});

test("backend: named versions restore selected prose and portable backups recover a separate book", { timeout: 60_000 }, async () => {
  const f = await book();
  try {
    const original = await f.cli(["scene", "add", "--title", "Gate", "--body", "The winter key is silver."]);
    const version = await f.cli(["revision", "save", "--message", "Silver key baseline"]);
    await f.cli(["scene", "update", "--id", original.id, "--body", "The winter key is copper."]);
    const scenePath = Object.keys(version.manifest).find(path => path.startsWith("manuscript/scenes/"))!;
    await f.cli(["revision", "restore", "--id", version.id, "--path", scenePath]);
    expect((await f.cli(["scene", "get", "--id", original.id])).body).toBe("The winter key is silver.\n");
    const backup = join(f.sandbox, "portable.zip");
    await f.cli(["backup", "create", "--target", backup]);
    expect((await f.cli(["backup", "verify", "--source", backup], f.sandbox)).verified).toBe(true);
    const destination = join(f.sandbox, "restored");
    expect((await f.cli(["backup", "restore", "--source", backup, "--target", destination], f.sandbox)).verified).toBe(true);
    expect((await f.cli(["scene", "get", "--id", original.id], destination)).body).toBe("The winter key is silver.\n");
    expect((await f.cli(["project", "inspect"], destination)).project_id).toBe("project-backend-e2e");
  } finally { await f.close(); }
});

test("backend: Storyline edits remain isolated and integrate through a reviewed Change Set", { timeout: 60_000 }, async () => {
  const f = await book();
  try {
    await f.cli(["scene", "add", "--title", "Gate", "--body", "The gate stays closed."]);
    const storyline = await f.cli(["storyline", "create", "--name", "Open the gate", "--hypothesis", "An earlier reveal strengthens the ending."]);
    await f.cli(["scene", "update", "--id", "scene-0001", "--body", "The gate opens at dawn."]);
    await f.cli(["storyline", "save", "--id", storyline.id]);
    await f.cli(["storyline", "switch", "--primary"]);
    expect((await f.cli(["scene", "get", "--id", "scene-0001"])).body).toBe("The gate stays closed.\n");
    const comparison = await f.cli(["storyline", "compare", "--id", storyline.id]);
    const scenePath = comparison.scenes[0].path;
    const integrated = await f.cli(["storyline", "integrate", "--id", storyline.id, "--scene-path", scenePath]);
    expect((await f.cli(["scene", "get", "--id", "scene-0001"])).body).toBe("The gate stays closed.\n");
    await f.cli(["proposal", "apply", "--id", integrated.proposals[0].id]);
    expect((await f.cli(["scene", "get", "--id", "scene-0001"])).body).toBe("The gate opens at dawn.\n");
  } finally { await f.close(); }
});

test("backend: reviewed local chat context and retried delivery produce one durable exchange", { timeout: 60_000 }, async () => {
  const f = await book();
  try {
    await f.cli(["scene", "add", "--title", "Gate", "--body", "Mara guards the winter gate."]);
    const thread = await f.cli(["chat", "thread", "create", "--title", "Gate revision", "--provider", "local", "--mode", "chat"]);
    const common = ["--thread", thread.id, "--message", "Discuss the gate.", "--current-scene", "scene-0001"];
    const context = await f.cli(["chat", "context", ...common]);
    expect(await f.cli(["chat", "message", "list", "--thread", thread.id])).toHaveLength(0);
    const first = await f.cli(["chat", "send", ...common, "--expected-context-fingerprint", context.fingerprint, "--request-id", "chat-e2e-delivery"]);
    const replay = await f.cli(["chat", "send", ...common, "--expected-context-fingerprint", context.fingerprint, "--request-id", "chat-e2e-delivery"]);
    expect(replay.user_message.id).toBe(first.user_message.id);
    expect(replay.assistant_message.id).toBe(first.assistant_message.id);
    expect(await f.cli(["chat", "message", "list", "--thread", thread.id])).toHaveLength(2);
  } finally { await f.close(); }
});

test("backend: persistent sidecar rejects invalid message limits and remains responsive", { timeout: 60_000 }, async () => {
  const f = await book();
  try {
    const thread = await f.cli(["chat", "thread", "create", "--title", "Validation", "--provider", "local"]);
    const invalid = ["1e999", "-1e999", "1.5", "true", '"ten"', "0", "-1"];
    const requests = invalid.map((limit, index) => `{"id":"invalid-${index}","method":"chat.messages","params":{"thread_id":"${thread.id}","limit":${limit}}}`);
    requests.push(`{"id":"oversized-integer","method":"chat.messages","params":{"thread_id":"${thread.id}","limit":${"9".repeat(5000)}}}`);
    requests.push(`{"id":"deeply-nested","method":"chat.messages","params":{"thread_id":"${thread.id}","limit":${"[".repeat(1500)}1${"]".repeat(1500)}}}`);
    requests.push(JSON.stringify({ id: "after-invalid", method: "ping" }));
    requests.push(JSON.stringify({ id: "valid-limit", method: "chat.messages", params: { thread_id: thread.id, limit: 10 } }));
    const frames = await f.sidecar(requests);
    for (let index = 0; index < invalid.length; index += 1) {
      expect(frames.find(frame => frame.id === `invalid-${index}`).error.category).toBe("invalid_request");
    }
    const decoderErrors = frames.filter(frame => frame.id === null);
    expect(decoderErrors.length).toBeGreaterThanOrEqual(1);
    const rejectedFrames = frames.filter(frame => frame.id === null || frame.id === "deeply-nested");
    expect(rejectedFrames).toHaveLength(2);
    for (const frame of rejectedFrames) expect(frame.error.category).toBe("invalid_request");
    expect(frames.find(frame => frame.id === "after-invalid").result.ok).toBe(true);
    expect(frames.find(frame => frame.id === "valid-limit").result).toEqual([]);
  } finally { await f.close(); }
});

test("backend: mobile snapshot and outbox replay preserve proposal review as the mutation boundary", { timeout: 60_000 }, async () => {
  const f = await book();
  try {
    await f.cli(["scene", "add", "--title", "Gate", "--body", "The gate stays closed."]);
    const revision = await f.cli(["revision", "save", "--message", "Mobile baseline"]);
    const payload = { kind: "capture_note", title: "Dawn image", content: "Let dawn touch the gate before Mara arrives." };
    const envelope = {
      project_id: "project-backend-e2e", device_id: "device-e2e", operation_id: "capture-e2e",
      base_revision: revision.id,
      payload_digest: `sha256:${createHash("sha256").update(JSON.stringify(payload, Object.keys(payload).sort())).digest("hex")}`,
    };
    const frames = await f.sidecar([
      JSON.stringify({ id: "snapshot", method: "mobile.snapshot.prepare", params: { project_id: envelope.project_id } }),
      JSON.stringify({ id: "capture", method: "mobile.outbox.import", params: { envelope, payload } }),
      JSON.stringify({ id: "replay", method: "mobile.outbox.import", params: { envelope, payload } }),
      JSON.stringify({ id: "inbox", method: "mobile.inbox.list" }),
    ]);
    const snapshot = frames.find(frame => frame.id === "snapshot").result;
    expect(parseMobileSnapshotManifest(snapshot.manifest).project_id).toBe(envelope.project_id);
    const plaintext = Buffer.from(snapshot.plaintext_base64, "base64").toString("utf8");
    expect(JSON.parse(plaintext).snapshot.scenes[0].body).toBe("The gate stays closed.\n");
    expect(plaintext).not.toContain(f.sandbox);
    expect(frames.find(frame => frame.id === "replay").result).toEqual(frames.find(frame => frame.id === "capture").result);
    expect(frames.find(frame => frame.id === "inbox").result).toHaveLength(1);
    expect((await f.cli(["scene", "get", "--id", "scene-0001"])).body).toBe("The gate stays closed.\n");
  } finally { await f.close(); }
});
