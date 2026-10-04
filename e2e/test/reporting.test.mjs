import assert from "node:assert/strict";
import { test } from "node:test";
import { playwrightVerification, sdkVerification } from "../scripts/reports.mjs";

test("SDK verification requires executed passes and rejects skipped or flaky selections", () => {
  const report = { run: { exitCode: 0, errors: [], results: [{ selected: true, status: "passed" }] } };
  assert.deepEqual(sdkVerification(report), { counts: { passed: 1 }, verified: true });
  for (const status of ["skipped", "flaky", "failed", "interrupted"]) {
    assert.equal(sdkVerification({ run: { ...report.run, results: [{ selected: true, status }] } }).verified, false);
  }
  assert.equal(sdkVerification({ run: { ...report.run, results: [{ selected: false, status: "passed" }] } }).verified, false);
  assert.equal(sdkVerification({ run: { ...report.run, results: [
    ...report.run.results,
    { selected: false, status: "skipped", skip: { cause: "filtered", reason: "not focused by .only" } },
  ] } }).verified, false);
  assert.equal(sdkVerification({ run: { ...report.run, exitCode: 3 } }).verified, false);
  assert.equal(sdkVerification({ run: { ...report.run, errors: [{ code: "CLEANUP_FAILED" }] } }).verified, false);
});

test("Playwright verification rejects zero tests, skips, expected failures and failed retry attempts", () => {
  const passed = { status: "expected", expectedStatus: "passed", results: [{ status: "passed" }] };
  const report = (tests, errors = []) => ({ errors, suites: [{ specs: [], suites: [{ specs: [{ tests }] }] }] });
  assert.deepEqual(playwrightVerification(report([passed, passed])), { counts: { expected: 2 }, verified: true });
  for (const invalid of [
    { ...passed, status: "skipped", results: [] },
    { ...passed, status: "flaky", results: [{ status: "failed" }, { status: "passed" }] },
    { ...passed, expectedStatus: "failed", results: [{ status: "failed" }] },
    { ...passed, results: [] },
    { ...passed, results: [{ status: "failed" }, { status: "passed" }] },
  ]) assert.equal(playwrightVerification(report([passed, invalid])).verified, false);
  assert.equal(playwrightVerification(report([])).verified, false);
  assert.equal(playwrightVerification(report([passed], [{ message: "server failed" }])).verified, false);
});
