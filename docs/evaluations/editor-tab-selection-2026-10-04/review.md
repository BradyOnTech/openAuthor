# Chosen review tab selection — 2026-10-04

Choosing a creative direction rejected the other two proposals and opened the chosen review tab, but left no tab selected. The workspace then displayed the welcome screen rather than the review's `Apply 1 change` control. The existing strict Chromium SDK journey caught this in the combined integration branch and in hosted CI.

Three focused executions reproduced the same failure with no retries. A minimized regression using the public `EditorProvider` and real `TabBar` reproduced the unselected chosen tab in 1.7 seconds, with no project persistence, workspace API or proposal generation involved. The failure screenshot and screen tree are retained here.

`closeTab` called the selected-tab setter from inside the tabs state updater. React 19 evaluated that queued updater after `openTab` selected the chosen review, clearing the selection. Tabs and their active ID now share one atomic state update. Opening, closing, refreshing and restoring use the current queued state, and updater functions have no nested state-setting side effects. Navigation revision fences, bookmark formats and split behavior remain unchanged.

The production fix is commit `2386aa80627275995c5fe008cce9a2ee45d6eb3e`. Five public-context regression tests cover asynchronous close→open, open→close with another document, closing inactive/active/last tabs, duplicate opening and refreshing, and restored selection/split persistence. The unchanged full SDK journey now passes three independent focused Chromium executions, including Apply, Undo, rejected-direction checks, unchanged-manuscript checks, provenance and console checks.

Validation passed **715 desktop tests in 93 files**, with no failures or skips, plus TypeScript and the production frontend build. Independent review found no actionable regression and independently passed all **14** tests across the context, keyboard tab bar and recovery files.

Focused probes use `--grep` and `--repeat-each 3`; each selected execution has one attempt. Eleven unselected discoveries are deliberately outside this focused validation. The full aggregate report guard rejects partial selections and remains unchanged. These focused reports are red/green evidence for this bug, not certification of the full desktop suite or all 79 flows; the parent integration performs the unfiltered final aggregate runs. SDK assertions, retries and timeouts were not changed.

Run the minimized regression with:

```sh
npm test --prefix desktop -- src/contexts/EditorContext.test.tsx
```

Run the original focused flow from `e2e/` with:

```sh
OPENAUTHOR_TEST_PYTHON=~/.local/bin/python3.11 \
  OPENAUTHOR_E2E_SUITE=desktop OPENAUTHOR_E2E_BROWSER=chromium \
  E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 \
  node node_modules/e2e/dist/cli/bin.js run \
  --grep 'saves a custom Editorial Pass' --repeat-each 3 \
  --output .e2e/editorial-direction-green
```

`verification.json` records source hashes and exact focused summaries. Compressed raw reports/logs retain the three failures, three passes, minimized regression failure, full unit result and frontend build. `artifact-sha256.json` seals the packet. Full failure traces remain in the ignored `.e2e/editorial-direction-red` directory; this packet retains the report, screenshot and screen tree without adding trace archives to the repository.
