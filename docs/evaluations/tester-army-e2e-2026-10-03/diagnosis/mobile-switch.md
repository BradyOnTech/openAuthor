# Downloaded-library press diagnosis

The WebKit hosted journey intermittently remained on Projects after clicking Use downloaded books. The app's project-loading indicator appeared above its mode and sign-out controls; finishing the project-list request removed the indicator and moved both controls upward while the reader's press was in progress.

Evidence and diagnosis:

- An unchanged focused hosted journey passed six repetitions: `mobile-switch-repeat-original.log` and `.json`. These were diagnostic repetitions, with no retries or timeout changes.
- Removing voice, capture, recovery corruption, and cold restarts left a project → Review → Projects → downloaded-library loop that reproduced the same failure at transition 18: `mobile-switch-minimized-loop.log` and `.json`.
- A targeted DOM event probe reproduced it at transition 6: `mobile-switch-minimized-events.log` and `.json`. Pointer-down targeted Use downloaded books at y134 with the spinner present. Pointer-up targeted Sign out at y98 after the spinner disappeared. The resulting click targeted their common parent, so the mode-button handler did not receive the click.
- The retained public regression at `mobile/e2e/hosted-companion.spec.ts` holds the synthetic hosted project-list response, presses the visible downloaded-library control, completes the response, and releases at the same screen coordinates. It requires actual Downloaded books and Reconnect controls. It failed before the production fix: `mobile-switch-regression-red.log` and `.json`.

The production fix in `mobile/App.tsx` places error/loading/retry status below the persistent library-mode and Sign out controls. Those actions remain usable while the project request is pending. The regression passed three repetitions after the fix: `mobile-switch-regression-green.log` and `.json`. The uninstrumented minimized loop then passed all 40 consecutive transitions: `mobile-switch-minimized-green.log` and `.json`.

All temporary diagnostic source/config and DOM event/global probes were removed. No retries, skipped cases, widened timeouts, or swallowed reload failures were introduced. `git diff --check` and the probe-prefix search passed.

After the production fix, mobile typecheck passed (`mobile-switch-typecheck.log`) and all 502 mobile unit tests in 37 files passed (`mobile-switch-vitest.log`). Final complete retained browser reports are `mobile-switch-final-{hosted,preview}-{webkit,chromium}.{log,json}`. The canonical runner independently rebuilds the guarded preview export before its final aggregate.

Final complete retained suites on frozen app source:

| Browser | Hosted | Preview |
| --- | --- | --- |
| WebKit | 3 passed, 27.7s | 4 passed, 4.5s |
| Chromium | 3 passed, 22.4s | 4 passed, 3.3s |

All four structured reports contain zero unexpected failures, zero flaky results, and zero skipped tests. Their server processes closed after completion.

These are local web/device-sized browser results with synthetic hosted HTTP, real browser storage/cryptography, and disposable project fixtures. Physical devices, native execution, production hosting/auth/RLS/device trust, and live provider/voice behavior are not established by this evidence.
