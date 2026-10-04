# tester-army/e2e public workflow verification

Both final full runs passed **79 tests**: 34 actual tester-army/e2e tests and
45 retained Playwright tests. Each run has 63 browser journeys and 16
engine-less core/gateway/database tests. Every test executed once; there were
zero failed, skipped, flaky or retried cases. The [flow catalogue](flows.md)
lists all 79 journeys, their source files and both browser results. The
[verification record](verification.json) links the actual reports and run IDs.

| Final local aggregate | tester-army/e2e | Retained Playwright | Total |
| --- | --- | --- | --- |
| Chromium | 34 passed | 45 passed | 79 passed |
| WebKit | 34 passed | 45 passed | 79 passed |

Three project agents handled desktop, mobile and backend coverage. The root
integrated the pinned [tester-army/e2e](https://github.com/tester-army/e2e)
runner, genuine web and native engines, PostgreSQL journey, report guards,
Make targets and CI. [The runbook](../../../e2e/README.md) documents installation
and focused/full commands. CI runs both full browser aggregates with read-only
GitHub permissions and archives each receipt beside its actual report trees
before a later run can overwrite shared backend/database outputs. This
workflow is implemented; a GitHub-hosted execution has not been claimed.

The browser adapter injects only the Tauri transport into the real desktop
shell and invokes the actual Python CLI/stdio engine against disposable books.
The mobile suite builds the guarded Expo web app and uses real contracts,
cryptography and browser storage against local protocol collaborators.
Gateway tests run the production HTTP/JWT/RPC/provider adapter code with local
JWKS/provider services. Database tests start a disposable Unix-socket cluster,
apply the actual migrations and exercise SQL authorization/concurrency. The
underlying gateway/database gate passed all 100 tests in each aggregate,
including the PostgreSQL cases, with no skips. No deployed database or real
provider was used by these journeys.

The work fixed these production defects and added public regressions:

- Clearing an individual budget limit previously retained it. Explicit clear
  fields now preserve unrelated limits. Fractional token counts, nonfinite
  costs and costs rounding to zero are refused. Usage updates after generation
  while unsaved policy edits survive; Clear all also clears unsaved fields when
  the persisted policy was already empty.
- Malformed budget roots/sections previously risked silently disabling limits.
  Invalid policy files now refuse generation without changing the policy,
  manuscript or generation history; explicit reset repairs the disposable file.
- Invalid `chat.messages` limits and huge/deeply nested JSON could terminate the
  persistent sidecar or escape as interpreter errors. They now return protocol
  errors, and subsequent requests succeed in the same process. SDK checks pass
  on both Python 3.11 and 3.13.
- Mobile scene search applied its limit before filtering by kind. Matching
  Memory entries could hide a scene. Filtering to scenes now happens first.
- Mobile project-loading status moved the library/sign-out buttons during a
  press. The controls now precede changing status content. A held HTTP response,
  pointer-down, response completion and same-position pointer-up reproduces the
  original bug and verifies the fix. [The diagnosis](diagnosis/mobile-switch.md)
  includes the red case, event evidence and 40 consecutive successful switches.
- Project tabs and Storyline choices now support keyboard interaction, merge
  fields have accessible names, and recovery notices expose announced results
  and keyboard dismissal. The Change Set composer exposes the existing
  Editorial Pass library and custom builder with persistent selection.

Test harness repairs retain the original product assertions. Preview offline
coverage now stops a real disposable shell server and reloads through the
service worker on both browsers. Chromium additionally checks hosted downloaded
restart with offline network emulation. WebKit's hosted fixture blocks service
workers for synthetic HTTPS interception; it proves downloaded restart and no
hosted requests during a simulated hosting outage while the shell remains
online. Browser media permission collaborators are installed on the correct
prototype, and stale desktop fixtures were updated for the current shell and
key-verifier protocol. No happy-path test swallows a recovery failure, widens
its timeout or gains retries.

One earlier WebKit aggregate recorded a connection loss while loading the lazy
Tauri event module, before `chat.send`. The question was preserved and retry
controls were shown. [The red trace excerpt](diagnosis/module-transport-excerpt.json)
records the failed GET without request headers. Focused unchanged promotion
repetitions and transport probes did not establish a cause; no speculative
keep-alive or product transport change was made. A separate SDK journey now
deliberately drops that module, verifies zero messages/generation runs, restores
availability, reloads and requires fresh context permission and exact prompt
review before one durable exchange. The successful promotion journey stays
strict. The final full runs both pass, but the earlier local transport failure
remains unexplained and retained in the diagnosis evidence.

Additional regression evidence is under `regression/`:

| Gate | Result |
| --- | --- |
| Full core, Python 3.11 | 583 tests: 582 passed, 1 opt-in Codex contract skipped |
| Opt-in Codex contract against local Responses service | 1 passed separately |
| Desktop unit suite and production build | 710 tests / 92 files passed; build passed |
| Mobile unit suite and types | 502 tests / 37 files passed; typecheck passed |
| SDK web/native types and report guards | Typecheck passed; 2 guard tests passed |
| Repository and capability checks | Passed; 20 e2e verified, 0 release-ready |
| Pinned runner dependency audit | 0 vulnerabilities reported |

The native engine has four public preview journeys, collected successfully for
iOS and Android. **No native journey was executed.** This environment has only
Command Line Tools, no full Xcode runtime or Android adb on the test path, and
no dedicated built mobile preview target. [Toolchain evidence](toolchain-final.json)
and the two native collection logs record that boundary. Physical microphone,
OS secure storage, background/network lifecycle, assistive technology, signed
clean-machine installation, deployed Auth/Storage operations and consenting
author/live-provider quality remain acceptance gates. Simple-prose interchange
tests cover Markdown, TXT, DOCX and Scrivener; packaged dialogs and rich-format
fidelity remain separate. These results do not mark the product release-ready.

Evidence describes the dirty working tree based on commit
`ebb49a1f2e5be61e2c40af0e6ecd59676a6c3228`, rather than a newly committed release.
[Source hashes](source-sha256.json) identify the changed/new implementation and
test files. [Author artifact hashes](author-preservation.json) confirm that the
four preexisting author artifacts remain unchanged. Compact gzip files retain
the raw reports, logs and selected red/green diagnosis receipts. Original media
artifact paths inside reports refer to the local/CI archives; media are not
duplicated in this compact packet. `artifact-sha256.json` seals the packet's
other files.
