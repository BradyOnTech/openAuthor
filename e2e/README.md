# Public workflow verification

This package uses the actual [tester-army/e2e](https://github.com/tester-army/e2e)
runner and its web and native mobile engines. Versions and transitive integrity
pins live in `package-lock.json`. Node 22.12 or newer is required.

The tests are deterministic: they use semantic UI actions, exact
assertions, the local Python provider, signed synthetic JWTs and local HTTP
services. No testing model, provider key or subscription login is needed.
The supported runner disables telemetry and omits provider credentials from
its child environment. Its reports count failures and unexpected skips as a
failed verification; retries are disabled.
Focused `.only` selections also fail the aggregate command, so a partial run
cannot produce a complete verification receipt.

## Run

From the repository root:

```sh
make install-js
npm run install:browsers --prefix e2e
make test-e2e
```

Run one project while working:

```sh
npm run test:desktop --prefix e2e
npm run test:mobile --prefix e2e
npm run test:backend --prefix e2e
npm run typecheck --prefix e2e
```

The mobile command performs the guarded production web export first. The
desktop target starts the real Vite shell. Both use allocated loopback ports,
and the runner stops the servers when the run ends. Tests create disposable
books and never use the repository's author project.

To include database authorization/concurrency and every existing browser
journey, install PostgreSQL 17 and set its executable directory:

```sh
# macOS; use the installed PostgreSQL bin directory on other platforms
brew install postgresql@17
OPENAUTHOR_TEST_PG_BIN="$(brew --prefix postgresql@17)/bin" make test-e2e-all
OPENAUTHOR_TEST_PG_BIN="$(brew --prefix postgresql@17)/bin" make test-e2e-webkit
```

The database test creates a new Unix-socket-only cluster, applies the actual
migrations, checks authorization and concurrent lifecycle operations, and runs
all gateway checks including the PostgreSQL integration cases. It does not use
or migrate a deployed database. `test-e2e-all` requires this runtime explicitly,
rather than silently skipping those flows.

For only the new browser tests on WebKit, use
`npm run test:webkit --prefix e2e`. The existing Playwright suites remain because
the pinned e2e SDK does not yet expose all offline, cross-tab, media, caret and
native-binding operations those tests exercise. `test-e2e-all` runs both
runners; each report identifies which runner produced its evidence.

## Coverage and evidence

The [October 3 verification packet](../docs/evaluations/tester-army-e2e-2026-10-03/review.md)
contains both full-run receipts, the executed flow catalogue, regression logs,
source hashes and remaining acceptance gates.

The complete local run contains 34 tester-army/e2e tests and 45 retained
Playwright tests: 63 browser journeys plus 16 core/gateway/database tests.
`test-e2e-all` and `test-e2e-webkit` each run this full local set; native
execution is separate.

| Project | Public interfaces under test | Coverage |
| --- | --- | --- |
| Desktop | Rendered React shell; real Python CLI/stdio transport | Onboarding, writing and stale saves, Plan, reviewed changes and undo, substantive Revision retrospectives and restore, Pass library, Style Profile, creative alternatives, keyboard tools, budget refusal and usage, reviewed Assistant artifact promotion, private dashboard, recovery and interchange |
| Mobile web | Guarded Expo/PWA export, browser SDK and encrypted hosted journey | Reading and search, all capture kinds, draft retention, review queue, sign-out and removal, preview restrictions, encrypted pairing/recovery/upload/import, offline shell, voice controls and cross-tab lifecycle |
| Core/contracts | Real CLI, one persistent stdio process, public snapshot parser | Import fingerprints, optimistic save recovery, proposal replay/review/apply/undo, named versions, backups, Storylines, reviewed chat replay, malformed-request survival and Python/TypeScript snapshot parity |
| Gateway | Real HTTP server, JWT/JWKS validation, production RPC/provider adapters, durable journals and leases | Origin/auth/device refusal, policy enforcement, issuance, ownership, renewal/stop, revocation, expiry, quota and provider failure cleanup |
| Database | Actual migrations, SQL policies and concurrent transactions | Active authority, key witnesses/recovery/rotation, registry bootstrap, project/account deletion and amendments, voice control and shared quota |

The new regression journeys cover these fixes:

- Clearing an individual budget limit now preserves the other limits. Token
  limits reject fractional values, and cost limits reject nonfinite values and
  amounts that round to zero. Displayed usage refreshes when generation ends,
  while unsaved budget edits survive that refresh.
- Invalid `chat.messages` limits return a protocol error while the persistent
  sidecar remains available for later requests. Oversized JSON integer frames
  and excessively nested JSON also return an error without terminating it.
- Malformed budget policy files refuse generation while preserving the file
  and manuscript. Explicit budget reset provides a working repair path.
- Mobile scene search filters to scenes before applying its result limit;
  matching Story Memory entries can no longer hide a matching scene.
- Mobile library-mode and sign-out buttons stay in place when the project list
  finishes loading, so a response arriving during a press cannot cancel it.
- Project tools and Storyline switching work from the keyboard. Merge fields
  have accessible names, and recovery notifications announce their result and
  provide a keyboard-accessible dismiss button.
- The Change Set composer exposes the existing Editorial Pass library and
  custom Pass builder, including saved Pass selection after reopening.

The desktop web adapter replaces only the Tauri transport. It injects the
bridge into the real served HTML and executes Python operations in a temporary
book; it does not synthesize manuscript responses. This is browser/core
coverage, with native Tauri bridge coverage retained in the existing Rust suite.
Mobile hosted collaborators are local protocol fixtures; real crypto,
contracts, browser storage and Python import execute against them.
The preview offline test shuts down its disposable HTTP server and then
reloads through the real service worker on both browsers. Chromium also checks
the hosted downloaded-mode restart with offline network emulation. WebKit's
hosted fixture blocks service workers so its synthetic HTTPS API remains
interceptable; it verifies downloaded-mode restart and zero hosted requests
during a simulated hosting outage while the local shell stays available.

Reports, JUnit summaries, screenshots and retained failure traces are under
`e2e/.e2e/<project>-<browser>/` (backend and database omit the browser suffix).
`verification.json` records the most recent aggregate command. Existing browser
artifacts remain in `desktop/test-results/` and `mobile/test-results/`.
The independent `public-workflow-e2e` CI workflow runs the local flow set on pull
requests and uploads the evidence. It has read-only GitHub permissions.
After each full run, `node e2e/scripts/archive.mjs chromium` (or `webkit`)
copies its receipt and actual reports into `e2e/.e2e/evidence-<browser>/` before
another run can replace the shared backend/database outputs. CI does this for
both browsers, including retained browser artifacts and security build receipts.
The evidence upload includes hidden files within these explicit test-output
paths, so `.e2e` reports survive the upload. It excludes fixture Git metadata
and environment files.
An additional desktop journey deliberately interrupts a lazy module download,
checks that the question survives with no generation, and recovers only after
fresh context permission and prompt review.

## Native targets and remaining acceptance

The official native engine is pinned for tests in `native-tests/`; the native
config targets the app's actual `com.openauthor.mobile` identifier. Running it
requires a built preview app and an iOS simulator/device or Android target.
These tests have separate execution evidence from phone-sized web tests.

```sh
# Collection checks config and test discovery only; it does not drive a device.
OPENAUTHOR_E2E_NATIVE_PLATFORM=ios npm run list:native --prefix e2e
OPENAUTHOR_E2E_NATIVE_PLATFORM=android npm run list:native --prefix e2e

# Use a dedicated target with an installed preview build, or provide its path.
OPENAUTHOR_E2E_NATIVE_PLATFORM=ios \
  OPENAUTHOR_E2E_NATIVE_APP_PATH=/absolute/path/openAuthor.app \
  npm run test:native --prefix e2e
```

`OPENAUTHOR_E2E_NATIVE_DEVICE` selects the target by name or identifier. For
Android, use `android` and a preview `.apk`. The suite checks that hosted voice
and sync are disabled before it uses the synthetic sample book. It has no
microphone grant or keychain-clearing step. Native execution must be performed
before claiming these four journeys pass.

Browser/core tests do not certify physical microphone/audio behavior, OS secure
storage, background/network lifecycle, accessibility with VoiceOver, signed
clean-machine desktop installation, deployed Auth/Storage operations or prose
quality with a live provider. Those acceptance gates remain in the project
readiness documents. A test collection or missing native runtime is never a
native pass.
