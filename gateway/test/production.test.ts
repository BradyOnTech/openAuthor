import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter, once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  createJsonLineAuditSink,
  startGatewayProcess,
  type ProcessSignalSource,
} from "../src/production.ts";

class FakeSignals extends EventEmitter implements ProcessSignalSource {
  exitCode: number | undefined;
}

function environment(): NodeJS.ProcessEnv {
  return {
    HOST: "127.0.0.1",
    PORT: "0",
    SUPABASE_URL: "https://fiction.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fiction",
    OPENAI_API_KEY: "sk-fiction-openai-key",
    SAFETY_IDENTIFIER_SECRET: "fiction-safety-secret-at-least-32-bytes",
    GATEWAY_SHUTDOWN_TIMEOUT_MS: "1000",
  };
}

test("writes one content-free JSON line per audit event", async () => {
  const writes: string[] = [];
  const sink = createJsonLineAuditSink({ write: (chunk) => void writes.push(chunk) });

  await sink.write({
    event: "realtime_session_issuance",
    requestId: "request-fiction",
    occurredAt: "2026-08-30T12:00:00.000Z",
    outcome: "forbidden",
    statusCode: 403,
    principalHash: "principal-hash",
    projectHash: "project-hash",
    deviceHash: "device-hash",
  });

  assert.deepEqual(writes, [
    "{\"event\":\"realtime_session_issuance\",\"requestId\":\"request-fiction\",\"occurredAt\":\"2026-08-30T12:00:00.000Z\",\"outcome\":\"forbidden\",\"statusCode\":403,\"principalHash\":\"principal-hash\",\"projectHash\":\"project-hash\",\"deviceHash\":\"device-hash\"}\n",
  ]);
});

test("starts the env-composed gateway and gracefully closes on SIGTERM or SIGINT", async () => {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    const signals = new FakeSignals();
    const output: string[] = [];
    const directory = mkdtempSync(join(tmpdir(), "openauthor-production-"));
    const server = await startGatewayProcess({ ...environment(), GATEWAY_CALL_JOURNAL_PATH: join(directory, "calls.json") }, {
      signals,
      auditOutput: { write: (chunk) => void output.push(chunk) },
      diagnosticOutput: { write: (chunk) => void output.push(chunk) },
    });
    const address = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });

    const closed = once(server, "close");
    signals.emit(signal);
    await closed;

    assert.equal(signals.exitCode, 0);
    assert.equal(output.join("").includes("sk-fiction"), false);
    assert.equal(output.join("").includes("fiction-safety"), false);
    await new Promise(resolve => setTimeout(resolve, 20));
    rmSync(directory, { recursive: true, force: true });
  }
});
