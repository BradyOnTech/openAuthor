# Repository reconciliation — 2026-10-04

The accumulated feature and E2E work is committed and published on
`codex/editorial-review-workspace`, with
[draft integration PR #22](https://github.com/BradyOnTech/openAuthor/pull/22).
It is **not merged into remote `main`**. Four preexisting author artifacts
remain uncommitted and unchanged.

## Access and local history

GitHub Desktop and the browser could see the private repository because their
owner session had access. The active GitHub CLI account was a different, secondary account;
the stored `BradyOnTech` login had access and push permission. Repository-local
Git credential routing now selects that existing owner login for this exact
repository. Ordinary `git ls-remote origin` succeeds. The helper retrieves the
credential from the existing CLI store during each request; no token is saved
in the helper, repository configuration, evidence or source. The global CLI
account and credential settings were not changed.

The implementation snapshot is `28e3a0954daf4b3b467659f46a817deae4fd7d90`.
It contains remote `main` at `2b343703f43beb866b3234dac336a4e49f76fa1f`,
with 43 additional commits and zero missing main commits. E2E work was committed
as `28e3a09` after its recorded validation. Its parent was `ebb49a1`.
The source hashes in the [E2E packet](../tester-army-e2e-2026-10-03/review.md)
identify the tested files; publication does not imply a new local test run.

The stale local `main` pointer had two local commits and was 25 commits behind
remote `main`. Both local commits were verified as ancestors of the published
feature branch before aligning the local `main` pointer with remote `main`.
The working tree remained on the feature branch throughout.

Only one active Git worktree exists. The attached earlier main-review worktree
is archived. Remote `codex/production-authoring` is an ancestor of main and
its work was merged through PR #21. The older
`feat/guided-merge-and-real-apply` branch belongs to
[merged PR #2](https://github.com/BradyOnTech/openAuthor/pull/2); its merge
commit is in main even though the original branch tip is not an ancestor.
Those historical branches were retained.

The implementation diff contains 1,868 files, with 202,410 additions and 2,126
deletions, including the accumulated evaluation corpus. This reconciliation
record adds documentation afterward. There are no cumulative author-content
changes under `.openauthor/`, `codex/` or `manuscript/` in the integration diff.
The four remaining local author files are:

- `.openauthor/project.json`
- `.openauthor/product_events.jsonl`
- `.openauthor/product_signals.json`
- `codex/suggestions.json`

Their hashes match the pre-publication preservation record in
[inventory.json](inventory.json). They were excluded from both commits and
the published branch diff.

## Dependency PR inventory

Before creating #22 there were **14 open PRs, all Dependabot updates**.
They were created against an older base, `b6b51ae`, before the authoring merge
on current main. Three have all recorded checks green; eleven have at least
one recorded failure. These older check results do not verify the integration
branch. [inventory.json](inventory.json) records each exact head and check URL.

| PR | Update | Recorded checks | Next work |
| --- | --- | --- | --- |
| [#7](https://github.com/BradyOnTech/openAuthor/pull/7) | upload-artifact 4 → 7 | 4 passed | Refresh against the final baseline; include the new E2E workflow when updating actions. |
| [#8](https://github.com/BradyOnTech/openAuthor/pull/8) | checkout 4 → 7 | 2 passed, 2 billing blocks | Refresh and rerun. |
| [#9](https://github.com/BradyOnTech/openAuthor/pull/9) | setup-node 4 → 7 | 4 passed | Refresh against the final baseline. |
| [#10](https://github.com/BradyOnTech/openAuthor/pull/10) | setup-python 5 → 7 | 1 passed, 1 billing block | Refresh and rerun. |
| [#11](https://github.com/BradyOnTech/openAuthor/pull/11) | Tauri Rust 2.10.2 → 2.10.3 | 2 billing blocks, 2 compile failures | Resolve the coupled Tauri runtime crate versions and build both architectures. |
| [#12](https://github.com/BradyOnTech/openAuthor/pull/12) | rfd 0.15.4 → 0.17.2 | 1 passed, 3 billing blocks | Review the minor-series migration and rerun. |
| [#13](https://github.com/BradyOnTech/openAuthor/pull/13) | serde_json 1.0.149 → 1.0.151 | 2 passed, 2 billing blocks | Refresh and rerun the Rust gates. |
| [#14](https://github.com/BradyOnTech/openAuthor/pull/14) | tauri-build 2.5.5 → 2.6.3 | 4 passed | Refresh and recheck with the coordinated Tauri baseline. |
| [#15](https://github.com/BradyOnTech/openAuthor/pull/15) | serde 1.0.228 → 1.0.229 | 3 passed, 1 billing block | Refresh and rerun arm64 packaging. |
| [#16](https://github.com/BradyOnTech/openAuthor/pull/16) | Desktop compatible npm group | 2 billing blocks, 2 Tauri version failures | Coordinate JavaScript API/CLI and Rust Tauri versions. |
| [#17](https://github.com/BradyOnTech/openAuthor/pull/17) | Vitest 4.1.11 → 5.0.2 | 2 passed, 2 billing blocks | Treat as a test-runner migration; rerun current suites and builds. |
| [#18](https://github.com/BradyOnTech/openAuthor/pull/18) | React and React types → 19.3 | 3 billing blocks, 1 npm peer conflict | Combine with ReactDOM and its types before installation and regression review. |
| [#19](https://github.com/BradyOnTech/openAuthor/pull/19) | ReactDOM and ReactDOM types → 19.3 | 4 billing blocks | Review together with #18; the PRs individually split the major versions. |
| [#20](https://github.com/BradyOnTech/openAuthor/pull/20) | TypeScript 5.9.3 → 7.0.2 | 4 billing blocks | Treat as a compiler migration and verify the current desktop build. |

All **31 recorded failed checks** were inspected. Twenty-six never started;
their annotations report failed account payments or a spending limit. Five did
execute and reveal three distinct problems:

1. #18 cannot resolve `@types/react-dom@18.3.7` against `@types/react@19.3.0`
   (`ERESOLVE`). Its two React major updates need a coordinated migration.
2. Both package jobs on #16 refuse Rust `tauri@2.10.2` with JavaScript
   `@tauri-apps/api@2.11.1` because their major/minor series differ.
3. Both package jobs on #11 fail compiling `tauri-runtime-wry@2.10.1` against
   the updated runtime traits (`E0046`/`E0053`).

These are historical observations, not freshly reproduced fixes. No dependency
PR was merged, rebased or closed during this reconciliation. The current
integration branch retains the same five Rust versions as main: Tauri 2.10.2,
tauri-build 2.5.5, serde 1.0.228, serde_json 1.0.149 and rfd 0.15.4.

## Integration checks and remaining work

The local E2E packet records **79 passed tests on Chromium and 79 on WebKit**,
with no skips, retries or flaky cases. It also records desktop/core/mobile
regressions and the precise local protocol/database collaborators. Native
preview tests were collected, but none was executed on a device.

Publishing #22 started real GitHub checks. The first push `full-gates` job
failed at `make js-audit`: the mobile dependency tree reports **17 high entries
from two underlying advisories**, Braces
`GHSA-vfj7-8cjw-p6xm` and node-forge `GHSA-86w9-cpqp-85rv`.
The contracts, desktop and gateway audits reported zero vulnerabilities before
that failure. The local byte-bound backports are implemented and tested, but
the [mobile runbook](../../../mobile/README.md#current-export-security-gate)
explicitly keeps the raw dependency audit mandatory and failing until the
release gate is resolved. This reconciliation preserves that gate.

At the first PR check snapshot, shared gateway quota passed on both push and
PR runs, arm64 unsigned package recovery passed, and x86_64 packaging/public
workflow tests were running. Later status snapshots belong in
`inventory.json`; a running job is not a pass. Historical billing failures
do not establish a current billing block: the new jobs are executing.

The next integration work is to resolve and review the two mobile dependency
security gates, complete the current PR checks/review, then refresh the bot
updates against that baseline. Action updates and Rust patches need fresh
checks; React/ReactDOM, Tauri, Vitest and TypeScript need their coordinated
migration work. Physical-device acceptance, deployed authorization, real
editorial-quality evaluation and signed clean-machine installation remain
separate release work. The capability ledger still records zero release-ready
capabilities.
