import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createMobileSyncService, type EncryptedMobileOutboxItem, type MobileSyncSidecar } from "../../desktop/src/mobileSync/mobileSync";
import { encodeRecoveryKey } from "../src/core/recoveryKey";
import type { OutboxEnvelope } from "../src/core/outbox";
import { exerciseVoiceControls } from "./voiceControls";

test.use({ serviceWorkers: "allow" });

// Real browser/SDK/storage/crypto plus the real desktop/Python snapshot and
// outbox import path. Only the hosted HTTP backend is simulated: this does NOT
// establish production auth/RLS, device trust, or live voice correctness.
test("a new phone retries enrollment, unlocks a desktop book and returns encrypted capture for review", async ({ page, context }, testInfo) => {
  const repo = resolve(process.cwd(), "..");
  const projectRoot = testInfo.outputPath("hosted-fixture");
  function python(operation: string, input?: unknown) {
    return JSON.parse(execFileSync("python3", [resolve(repo, "mobile/e2e/project_fixture.py"), operation, projectRoot], {
      cwd: repo, env: { ...process.env, PYTHONPATH: repo }, encoding: "utf8", input: JSON.stringify(input ?? {}),
    }));
  }
  let prepared = python("prepare");
  const projectId = prepared.manifest.project_id as string;
  const userId = "10000000-0000-4000-8000-000000000001";
  const workspaceId = "30000000-0000-4000-8000-000000000001";
  const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => index);
  const projectKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  const recoveryKey = await encodeRecoveryKey(Buffer.from(keyBytes).toString("base64"));
  const outbox: EncryptedMobileOutboxItem[] = [];
  const sidecar: MobileSyncSidecar = {
    prepareSnapshot: async () => prepared,
    importOutboxItem: async (_root, input) => python("import", input),
  };
  const desktop = createMobileSyncService({
    sidecar,
    transport: { publishSnapshot: async () => {}, pullOutbox: async () => outbox.splice(0) },
  });
  let published = await desktop.publishSnapshot({ projectRoot, projectId, projectKey, keyVersion: 1 });
  const bytea = (base64: string) => `\\x${Buffer.from(base64, "base64").toString("hex")}`;
  const registrations: Record<string, unknown>[] = [];
  const requests: { path: string; body: string }[] = [];
  const errors: string[] = [];
  const backendAttempts: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://")) backendAttempts.push(request.url());
  });
  let deviceId: string | null = null;
  let loseRegistrationResponse = true;
  let missingBookKey = true;
  let hostingOffline = false;
  const user = { id: userId, email: "fixture@author.test", aud: "authenticated", role: "authenticated" };
  const session = () => {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = `${part({ alg: "HS256", typ: "JWT" })}.${part({
      sub: userId, aud: "authenticated", role: "authenticated", email: user.email,
      exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
      session_id: "40000000-0000-4000-8000-000000000001", ...(deviceId ? { device_id: deviceId } : {}),
    })}.${Buffer.from("test-only-signature").toString("base64url")}`;
    return { access_token: token, refresh_token: "local-fixture-refresh", expires_in: 3600, token_type: "bearer", user };
  };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://companion-backend.test/**", async (route) => {
    if (hostingOffline) return route.abort("internetdisconnected");
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postData() ?? "";
    requests.push({ path, body });
    const reply = (json: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
    if (path === "/auth/v1/token") return reply(session());
    if (path === "/auth/v1/user") return reply(user);
    if (path === "/auth/v1/logout") return reply({});
    if (path === "/rest/v1/projects") return reply([{
      id: projectId, workspace_id: workspaceId, name: "The Winter Observatory", slug: "winter-observatory",
      kind: "book", status: "active", updated_at: new Date().toISOString(),
    }]);
    if (path.endsWith("/mobile_register_device")) {
      const input = JSON.parse(body);
      registrations.push(input);
      deviceId = input.p_device_id;
      if (loseRegistrationResponse) { loseRegistrationResponse = false; return reply({ message: "Fixture response lost after commit" }, 503); }
      return reply({ id: deviceId, enrolled_at: new Date().toISOString() });
    }
    if (path.endsWith("/mobile_enroll_project_device")) return reply({});
    if (path.endsWith("/mobile_get_project_key_envelopes")) {
      expect(missingBookKey).toBe(true);
      return reply([]);
    }
    if (path.endsWith("/mobile_list_snapshot_manifests")) return reply([{
      snapshot_id: published.snapshot_id, project_id: projectId, project_revision: published.manifest.revision,
      key_version: 1, schema_version: 1, object_bucket: published.object.bucket, object_path: published.object.path,
      object_byte_length: published.object.byte_length, object_sha256: published.object.sha256,
      manifest_algorithm: "aes-256-gcm-v1", manifest_nonce: bytea(published.hosted_manifest.nonce_base64),
      manifest_ciphertext: bytea(published.hosted_manifest.ciphertext_base64),
      manifest_ciphertext_sha256: published.hosted_manifest.ciphertext_sha256,
      created_at: new Date().toISOString(),
    }]);
    if (path.includes("/storage/v1/object/")) return route.fulfill({ body: published.ciphertext_base64, contentType: "text/plain" });
    if (path.endsWith("/mobile_ack_snapshot")) return reply({});
    if (path.endsWith("/mobile_append_outbox")) {
      const input = JSON.parse(body);
      const combined = Buffer.from(Buffer.from(input.p_ciphertext.slice(2), "hex").toString("utf8"), "base64");
      outbox.push({
        schema_version: 1, receivedAt: new Date().toISOString(),
        envelope: { projectId, deviceId: input.p_requesting_device_id, operationId: input.p_operation_id,
          baseRevision: input.p_base_project_revision, kind: input.p_operation_type, keyVersion: input.p_key_version },
        encryption: { algorithm: "AES-256-GCM", iv_base64: combined.subarray(0, 12).toString("base64"), associated_data_version: 1 },
        ciphertext_base64: combined.subarray(12).toString("base64"),
      });
      return reply({ received_at: new Date().toISOString() });
    }
    throw new Error(`Unexpected fixture backend path: ${path}`);
  });
  const readScene = async (title: string) => {
    await page.getByRole("tab", { name: "Scenes", exact: true }).click();
    const back = page.getByRole("button", { name: "Back to scenes", exact: true });
    if (await back.isVisible()) await back.click();
    await page.getByRole("button", { name: `Read ${title}`, exact: true }).click();
  };
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(/mobile_register_device failed/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /The Winter Observatory/ }).click();
  await expect(page.getByText("Unlock this book on your phone", { exact: true })).toBeVisible();
  expect(registrations.length).toBeGreaterThanOrEqual(2);
  for (const registration of registrations) expect(registration).toEqual(registrations[0]);
  await page.getByLabel("Book key version").fill("1");
  await page.getByLabel("Book recovery key").fill(await encodeRecoveryKey(Buffer.alloc(32, 9).toString("base64")));
  await page.getByRole("button", { name: "Verify key and open book" }).click();
  await expect(page.getByText(/cannot unlock the selected book/)).toBeVisible();
  await page.getByLabel("Book recovery key").fill(recoveryKey);
  await page.getByRole("button", { name: "Verify key and open book" }).click();
  await expect(page.getByRole("button", { name: /^Read / })).toHaveText([
    /The Blue Hour/, /The Snow Key/, /A Loose Page/,
  ]);
  await page.getByRole("textbox", { name: "Search scenes" }).fill("Arrival");
  await expect(page.getByRole("button", { name: /^Read / })).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search scenes" }).fill("");
  await page.getByRole("button", { name: "Read The Blue Hour" }).click();
  await expect(page.getByText("Winter · Arrival", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous scene", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Next scene", exact: true }).click();
  await expect(page.getByText("Winter · Discovery", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next scene", exact: true }).click();
  await expect(page.getByText("Unassigned scenes", { exact: true })).toBeVisible();
  await expect(page.getByText("An unsorted page waited in her notebook.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next scene", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Previous scene", exact: true }).click();
  await expect(page.getByText(/Scene 2 of 3 · Desktop Plan reading order/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("plan-ordered-reader.png"), fullPage: true });
  await page.getByRole("button", { name: "Back to scenes", exact: true }).click();
  await readScene("The Snow Key");
  missingBookKey = false;
  await expect(page.getByText(/Mara found a brass key beneath/)).toBeVisible();
  await page.getByRole("button", { name: "Discuss this scene", exact: true }).click();
  await expect(page.getByText("Discussing: The Snow Key", { exact: true })).toBeVisible();
  await expect(page.getByText("Status: idle", { exact: true })).toBeInViewport();
  await expect(page.getByText(/Selected story context and microphone audio/)).toBeInViewport();
  await expect(page.getByText("Writing Voice: Winter restraint", { exact: true })).toBeVisible();
  await expect(page.getByText("Let physical choices carry emotion.", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("compact-assistant.png"), fullPage: true });
  await page.getByRole("button", { name: "Show context details", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hide context details", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Let physical choices carry emotion.", { exact: true })).toBeVisible();
  await expect(page.getByText(/not Copilot's speaking personality/)).toBeVisible();
  await expect(page.getByText("2 accepted story facts selected from this snapshot for this scene.", { exact: true })).toBeVisible();
  await expect(page.getByText(/1 selected fact has missing source passages/)).toBeVisible();
  await page.getByRole("button", { name: "Discuss without a selected scene", exact: true }).click();
  await expect(page.getByText("Discussing: The Snow Key", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Hide context details", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("downloaded-writing-voice.png"), fullPage: true });
  // Withdrawal changes the next encrypted publication, not an already-open copy.
  prepared = python("withdraw-fact");
  const previousSnapshotId = published.snapshot_id;
  published = await desktop.publishSnapshot({ projectRoot, projectId, projectKey, keyVersion: 1 });
  expect(published.snapshot_id).not.toBe(previousSnapshotId);
  await expect(page.getByText("2 accepted story facts selected from this snapshot for the book.", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /The Winter Observatory/ }).click();
  await readScene("The Snow Key");
  await page.getByRole("tab", { name: "Assistant", exact: true }).click();
  await expect(page.getByText("Writing Voice: Winter restraint", { exact: true })).toBeVisible();
  await expect(page.getByText("1 accepted story fact selected from this snapshot for this scene.", { exact: true })).toBeVisible();
  await expect(page.getByText(/missing source passages/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("refreshed-story-facts.png"), fullPage: true });
  await exerciseVoiceControls(page, testInfo);
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  const note = "Let the key open the clock instead of the door.";
  await page.getByRole("button", { name: "dictated passage", exact: true }).click();
  await page.getByLabel("Capture text").fill(note);
  await page.getByRole("tab", { name: "Scenes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Discuss this scene", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  await expect(page.getByLabel("Capture text")).toHaveValue(note);
  await expect(page.getByText("Reading position and capture draft saved on this device.", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 550 });
  await page.getByRole("tab", { name: "Scenes", exact: true }).click();
  const readOffset = await page.getByText(/Mara found a brass key beneath/).evaluate((element) => {
    let parent = element.parentElement;
    while (parent && parent.scrollHeight <= parent.clientHeight) parent = parent.parentElement;
    if (!parent) throw new Error("Expected a scrollable manuscript reader");
    parent.scrollTop = 140;
    return parent.scrollTop;
  });
  expect(readOffset).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("openauthor-companion-v1");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const get = <T>(store: string, key: IDBValidKey) => new Promise<T>((resolve, reject) => {
      const request = database.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const keys = await new Promise<IDBValidKey[]>((resolve) => {
        const request = database.transaction("records").objectStore("records").getAllKeys();
        request.onsuccess = () => resolve(request.result);
      });
      const slot = keys.find((key) => String(key).startsWith("companion-recovery:"));
      if (!slot) return null;
      const record = await get<{ iv: Uint8Array<ArrayBuffer>; bytes: ArrayBuffer }>("records", slot);
      const key = await get<CryptoKey>("keys", "wrapping-key");
      const decoded = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData: new TextEncoder().encode(String(slot)) }, key, record.bytes)));
      return decoded.state.reading?.scrollY;
    } finally { database.close(); }
  })).toBe(readOffset);
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  await expect(page.getByText("Reading position and capture draft saved on this device.", { exact: true })).toBeVisible();
  // Quota/encryption failures keep the current draft and expose a durable-save
  // failure. A retry must commit the same latest state before a cold restart.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (String(key).startsWith("companion-recovery:")) {
        IDBObjectStore.prototype.put = put;
        throw new DOMException("Fixture: encrypted draft storage full", "QuotaExceededError");
      }
      return put.call(this, value, key);
    };
  });
  await page.getByLabel("Capture text").fill(`${note} Keep this on failure.`);
  await expect(page.getByText("Draft changes are not saved for restart.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Capture text")).toHaveValue(`${note} Keep this on failure.`);
  await page.getByRole("button", { name: "Retry reading and capture recovery" }).click();
  await expect(page.getByText("Reading position and capture draft saved on this device.", { exact: true })).toBeVisible();
  await page.getByLabel("Capture text").fill(note);
  await expect(page.getByText("Reading position and capture draft saved on this device.", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /The Winter Observatory/ }).click();
  await expect(page.getByRole("tab", { name: "Capture", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Capture text")).toHaveValue(note);
  await expect(page.getByRole("button", { name: "dictated passage", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: "Scenes", exact: true }).click();
  await expect(page.getByText(/Mara found a brass key beneath/)).toBeVisible();
  await expect.poll(() => page.getByText(/Mara found a brass key beneath/).evaluate((element) => {
    let parent = element.parentElement;
    while (parent && parent.scrollHeight <= parent.clientHeight) parent = parent.parentElement;
    return parent?.scrollTop;
  })).toBe(readOffset);
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("recovered-unfinished-capture.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("openauthor-companion-v1");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const records = database.transaction("records").objectStore("records");
      const keys = await new Promise<IDBValidKey[]>((resolve) => { const read = records.getAllKeys(); read.onsuccess = () => resolve(read.result); });
      const slot = keys.find((key) => String(key).startsWith("companion-recovery:"))!;
      const record = await new Promise<unknown>((resolve) => { const read = database.transaction("records").objectStore("records").get(slot); read.onsuccess = () => resolve(read.result); });
      (globalThis as unknown as { retainedRecovery: unknown }).retainedRecovery = { slot, record };
    } finally { database.close(); }
  });
  // One failed local write must not erase the draft or pretend it was saved.
  // This changes only this disposable browser's next outbox insert.
  await page.evaluate(() => {
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
      if (this.name === "outbox") {
        IDBObjectStore.prototype.add = originalAdd;
        throw new Error("Fixture: capture storage is temporarily unavailable.");
      }
      return originalAdd.call(this, value, key);
    };
  });
  await page.getByRole("button", { name: "Save pending item" }).click();
  await expect(page.getByText("Fixture: capture storage is temporarily unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Capture text")).toHaveValue(note);
  await page.getByRole("button", { name: "Save pending item" }).click();
  await expect(page.getByText("Pending review", { exact: true })).toBeVisible();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  // Reproduce a process exit after outbox insertion but before draft-clearing
  // commits: restore the last durable encrypted draft, then start a fresh app.
  // Retrying that recovered operation must leave exactly one outbox item.
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  await expect(page.getByLabel("Capture text")).toHaveValue("");
  await expect(page.getByText("Reading position and capture draft saved on this device.", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const retained = (globalThis as unknown as { retainedRecovery: { slot: IDBValidKey; record: unknown } }).retainedRecovery;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("openauthor-companion-v1");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("records", "readwrite");
        transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
        transaction.objectStore("records").put(retained.record, retained.slot);
      });
    } finally { database.close(); }
  });
  await page.reload();
  await page.getByRole("button", { name: /The Winter Observatory/ }).click();
  await expect(page.getByLabel("Capture text")).toHaveValue(note);
  await page.getByRole("button", { name: "Save pending item" }).click();
  await expect(page.getByText("Pending review", { exact: true })).toBeVisible();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  // A cold reopen must decrypt the persistent queue, not reuse the submitted
  // text held in React state. The at-rest store must contain only ciphertext.
  await page.reload();
  await page.getByRole("button", { name: /The Winter Observatory/ }).click();
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("openauthor-companion-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const request = database.transaction("outbox").objectStore("outbox").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  });
  const records = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("openauthor-companion-v1");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const request = database.transaction("records").objectStore("records").getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  });
  expect(JSON.stringify(records)).not.toContain(note);
  expect(JSON.stringify(records)).not.toContain("Mara found a brass key");
  expect(saved).toHaveLength(1);
  expect(JSON.stringify(saved)).not.toContain(note);
  const originalEnvelope = saved[0] as OutboxEnvelope;
  async function replaceFixtureEnvelope(value: OutboxEnvelope) {
    await page.evaluate(async (envelope) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("openauthor-companion-v1");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction("outbox", "readwrite");
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
          transaction.objectStore("outbox").put(envelope, envelope.operationId);
        });
      } finally { database.close(); }
    }, value);
  }
  // Test-only corruption below intentionally bypasses the immutable adapter.
  // Recompute the public checksum so that real AES authentication, not only
  // the digest check, must reject the damaged ciphertext after a cold reopen.
  const damagedBytes = Buffer.from(originalEnvelope.ciphertext, "base64");
  damagedBytes[damagedBytes.length - 1] = damagedBytes[damagedBytes.length - 1]! ^ 1;
  const damagedCiphertext = damagedBytes.toString("base64");
  const damagedDigest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(damagedCiphertext))).toString("hex");
  await replaceFixtureEnvelope({ ...originalEnvelope, ciphertext: damagedCiphertext, ciphertextDigest: damagedDigest });
  await page.reload();
  await page.getByRole("button", { name: /The Winter Observatory/ }).click();
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  await expect(page.getByText("Preview unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText(note, { exact: true })).toHaveCount(0);
  await expect(page.getByText(/nothing was deleted/)).toBeVisible();
  await replaceFixtureEnvelope(originalEnvelope);
  await page.getByRole("tab", { name: "Scenes", exact: true }).click();
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("readable-pending-capture.png"), fullPage: true });
  // The actual PWA shell must support a cold offline restart. Expire the
  // persisted SDK session in this disposable fixture; do not fake online auth.
  await page.getByRole("button", { name: "‹ Projects", exact: true }).click();
  await page.getByRole("button", { name: "Use downloaded books", exact: true }).click();
  await expect(page.getByText("Downloaded books", { exact: true })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("openauthor-companion-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    async function get<T>(store: string, key: string): Promise<T> {
      return new Promise((resolve, reject) => {
        const request = database.transaction(store).objectStore(store).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    try {
      const slot = "auth:sb-companion-backend-auth-token";
      const key = await get<CryptoKey>("keys", "wrapping-key");
      const record = await get<{ iv: Uint8Array<ArrayBuffer>; bytes: ArrayBuffer }>("records", slot);
      const additionalData = new TextEncoder().encode(slot);
      const value = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData }, key, record.bytes)));
      value.expires_at = Math.floor(Date.now() / 1000) - 3600;
      value.expires_in = 0;
      const parts = value.access_token.split(".");
      const claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      claims.exp = value.expires_at;
      parts[1] = btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      value.access_token = parts.join(".");
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, new TextEncoder().encode(JSON.stringify(value)));
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("records", "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.objectStore("records").put({ iv, bytes }, slot);
      });
    } finally { database.close(); }
  });
  let attemptsBeforeOffline = backendAttempts.length;
  hostingOffline = true;
  await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await page.reload();
  // Chrome 152 may reset navigator.onLine on reload even under offline network
  // emulation. Downloaded mode must persist and never rely on this hint alone.
  await expect(page.getByText("Downloaded books", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /The Winter Observatory/ }).click();
  await readScene("The Snow Key");
  await expect(page.getByText(/Mara found a brass key beneath/)).toBeVisible();
  await page.getByRole("tab", { name: "Assistant", exact: true }).click();
  await page.getByRole("button", { name: "Start voice", exact: true }).click();
  await expect(page.getByText(/Reconnect to the online library to use sync, voice or key recovery/)).toBeVisible();
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  const offlineNote = "Offline idea: the clock runs backward when Mara lies.";
  await page.getByLabel("Capture text").fill(offlineNote);
  await expect(page.getByText("Reading position and capture draft saved on this device.", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /The Winter Observatory/ }).click();
  await expect(page.getByLabel("Capture text")).toHaveValue(offlineNote);
  expect(backendAttempts.length).toBe(attemptsBeforeOffline);
  await page.getByRole("button", { name: "Save pending item" }).click();
  await expect(page.getByText("Pending review", { exact: true })).toBeVisible();
  await expect(page.getByText(offlineNote, { exact: true })).toBeVisible();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByText(/Reconnect to the online library to use sync, voice or key recovery/)).toBeVisible();
  expect(outbox).toHaveLength(0);
  await page.reload();
  await page.getByRole("button", { name: /The Winter Observatory/ }).click();
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  await expect(page.getByText(offlineNote, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("offline-captures.png"), fullPage: true });
  expect(backendAttempts.length).toBe(attemptsBeforeOffline);
  // Reconnection must actually refresh the expired SDK session before returning
  // to the online library, without uploading anything on the user's behalf.
  const tokensBeforeReconnect = requests.filter((request) => request.path === "/auth/v1/token").length;
  hostingOffline = false;
  await context.setOffline(false);
  await page.getByRole("button", { name: "‹ Projects", exact: true }).click();
  await page.getByRole("button", { name: "Reconnect to online library", exact: true }).click();
  await expect(page.getByRole("button", { name: "Use downloaded books", exact: true })).toBeVisible();
  expect(requests.filter((request) => request.path === "/auth/v1/token").length).toBeGreaterThan(tokensBeforeReconnect);
  expect(outbox).toHaveLength(0);
  await page.getByRole("button", { name: "Use downloaded books", exact: true }).click();
  await expect(page.getByText("Downloaded books", { exact: true })).toBeVisible();
  attemptsBeforeOffline = backendAttempts.length;
  hostingOffline = true;
  await context.setOffline(true);
  await page.getByRole("button", { name: /The Winter Observatory/ }).click();
  // Signing out offline must lock the downloaded library and clear the saved
  // session without deleting the author's unsynced, encrypted captures.
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const secondWindow = await context.newPage();
  const secondHostedAttempts: string[] = [];
  secondWindow.on("request", (request) => { if (request.url().startsWith("https://")) secondHostedAttempts.push(request.url()); });
  await secondWindow.goto("/");
  await expect(secondWindow.getByText("Downloaded books", { exact: true })).toBeVisible();
  await secondWindow.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(secondWindow.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByText(/Mara found a brass key beneath/)).toHaveCount(0);
  await expect(page.getByLabel("Capture text")).toHaveCount(0);
  expect(secondHostedAttempts).toEqual([]);
  await secondWindow.close();
  await page.getByRole("button", { name: "Open downloaded books", exact: true }).click();
  await expect(page.getByText(/Signing out locks local access/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(backendAttempts.length).toBe(attemptsBeforeOffline);
  const signedOutStorage = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("openauthor-companion-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const [recordKeys, envelopes] = await Promise.all([
        new Promise<IDBValidKey[]>((resolve) => {
          const request = database.transaction("records").objectStore("records").getAllKeys();
          request.onsuccess = () => resolve(request.result);
        }),
        new Promise<unknown[]>((resolve) => {
          const request = database.transaction("outbox").objectStore("outbox").getAll();
          request.onsuccess = () => resolve(request.result);
        }),
      ]);
      return { authKeys: recordKeys.filter((key) => String(key).startsWith("auth:sb-companion-backend-auth-token")), envelopes };
    } finally { database.close(); }
  });
  expect(signedOutStorage.authKeys).toEqual([]);
  expect(signedOutStorage.envelopes).toHaveLength(2);
  expect(JSON.stringify(signedOutStorage.envelopes)).not.toContain(offlineNote);
  hostingOffline = false;
  await context.setOffline(false);
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: /The Winter Observatory/ }).click();
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  await expect(page.getByText(offlineNote, { exact: true })).toBeVisible();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect.poll(() => outbox.length).toBe(2);
  await expect(page.getByText("2 uploaded · 0 waiting. Open desktop to import and review uploaded items.")).toBeVisible();
  await expect(page.getByText("No items are waiting to upload from this device. Uploaded items may still need desktop review.")).toBeVisible();
  const heading = await page.getByText("Pending review", { exact: true }).boundingBox();
  expect(heading!.x).toBeGreaterThanOrEqual(0);
  expect(heading!.x + heading!.width).toBeLessThanOrEqual(390);
  const imported = await desktop.importOutbox({ projectRoot, projectId, projectKey, keyVersion: 1 });
  expect(imported.failures).toEqual([]);
  expect(imported.imported).toHaveLength(2);
  const inspected = python("inspect");
  expect(inspected.inbox.map((item: { payload: { content: string } }) => item.payload.content)).toContain(offlineNote);
  expect(inspected.proposals).toEqual(expect.arrayContaining([expect.objectContaining({
    proposed_body: note, status: "pending", source: "mobile_outbox",
  })]));
  expect(inspected.scene.body.trim()).toBe("Mara found a brass key beneath the observatory's frozen door.");
  const rpcBodies = requests.filter((request) => request.path.startsWith("/rest/")).map((request) => request.body).join("\n");
  expect(rpcBodies).not.toContain(recoveryKey);
  expect(rpcBodies).not.toContain(Buffer.from(keyBytes).toString("base64"));
  expect(rpcBodies).not.toContain(note);
  expect(rpcBodies).not.toContain(offlineNote);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("paired-companion.png"), fullPage: true });
});
