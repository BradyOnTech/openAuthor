import { test, expect } from "e2e";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("database authorization, key recovery, deletion, voice leases and shared quota survive concurrency", { timeout: 240_000 }, async () => {
  const pgBin = process.env.OPENAUTHOR_TEST_PG_BIN;
  if (!pgBin) throw new Error("Set OPENAUTHOR_TEST_PG_BIN to run the disposable PostgreSQL flows.");
  const output = resolve(repository, "e2e/.e2e/database");
  await mkdir(output, { recursive: true });
  try {
    const result = await execute(process.env.OPENAUTHOR_TEST_PYTHON ?? "python3", [
      "scripts/verify_shared_gateway_limiter.py", "--pg-bin", pgBin,
    ], { cwd: repository, env: process.env, timeout: 220_000, maxBuffer: 16 * 1024 * 1024 });
    await Promise.all([
      writeFile(resolve(output, "postgres-stdout.txt"), result.stdout),
      writeFile(resolve(output, "postgres-stderr.txt"), result.stderr),
    ]);
    expect(result.stdout).toContain("Existing encrypted-sync authorization SQL suite passed.");
    expect(result.stdout).toContain("mobile_project_key_verifiers.sql: real PostgreSQL checks passed.");
    expect(result.stdout).toMatch(/# fail 0\b/);
    expect(result.stdout).toMatch(/# skipped 0\b/);
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    if (failed.stdout !== undefined) await writeFile(resolve(output, "postgres-stdout.txt"), failed.stdout);
    if (failed.stderr !== undefined) await writeFile(resolve(output, "postgres-stderr.txt"), failed.stderr);
    throw error;
  }
});
