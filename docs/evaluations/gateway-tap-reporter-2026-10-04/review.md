# Explicit gateway TAP output

On frozen `679481a`, all 100 gateway tests and SQL/concurrency checks passed under Node 24.19.0, but the tester-army database case failed its existing `# fail 0` assertion. The captured subprocess output uses spec lines (`ℹ fail 0`, `ℹ skipped 0`) instead of TAP. The original failed database report and exact stdout/stderr are retained.

The same focused three tests demonstrate the boundary with piped output: Node 22.17.0 defaults to TAP, while Node 24.19.0 defaults to spec. Explicit `--test-reporter=tap` produces the required zero-failure/zero-skip summary on both. [Official Node documentation](https://nodejs.org/docs/latest-v24.x/api/test.html#test-reporters) records this default change starting with Node 23; [Node 22 documentation](https://nodejs.org/download/release/v22.17.0/docs/api/test.html#test-reporters) describes its earlier reporters. Node 22.17 is only a gateway reporter probe, not complete upgraded-toolchain acceptance.

The fix adds only `--test-reporter=tap` to the gateway test producer command. Type stripping, test glob, concurrency, test inventory, existing E2E assertions, timeouts, retries and report gates remain unchanged. Production source and dependency locks are unchanged.

The actual existing tester-army runner then selected the single `database` target and `tests/backend-database.e2e.ts`. It passed one test in one attempt with zero failed/flaky/skipped results, including all real PostgreSQL SQL/concurrency checks and 100 gateway tests plus typecheck/build. The captured subprocess now contains exact TAP zero-failure and zero-skip summaries. The runner's strict verification receipt passed.

Source and artifact hashes bind the verified source commit in `verification.json`. Gzip files preserve exact original bytes with decompressed-byte hashes. Both earlier packets remain immutable. Full 79 Chromium plus 79 WebKit acceptance at the next frozen head remains separate work.
