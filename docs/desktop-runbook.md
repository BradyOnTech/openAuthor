# Desktop Runbook (macOS-first)

## Release profile

- Platform: macOS first (`aarch64` + `x86_64`).
- Packaging path: Tauri bundle output from `desktop/src-tauri/target/release/bundle/`.
- Runtime: pinned Python 3.11, Codex app-server, and local Git distributions inside the app bundle; users do not install Python, Node, Codex, or Git.
- Gate required before packaging:
  - `make desktop-smoke`
  - `make test-scale`
  - `make test-canon-eval`
  - `make test-editorial-eval`
- Current release quality bar:
  - All automated gates green.
  - Manual smoke checklist below completed.

## Prerequisites

Operator machine requirements:

- Python 3.11+ with editable core install (`pip install -e .`)
- Node.js 22.22.2+ on 22.x, 24.15+ on 24.x, or 26+ (use the repository's `.nvmrc` to select Node 22)
- Rust stable toolchain (`cargo`, `rustc`)
- macOS build dependencies required by Tauri/WebKit

Validation command:

```bash
make desktop-prereq
```

## Real-engine browser workflow

```bash
make install-desktop
npx --prefix desktop playwright install chromium
make test-desktop-e2e
```

This opens the rendered application in Chromium and adapts only the native
transport to real Python CLI subprocesses. It creates a disposable novel, writes
prose, enters/exits focus mode, generates a deterministic local-provider Change
Set, reviews/applies/undoes it, and reloads the saved manuscript. Screenshots and
failure traces are saved under `desktop/test-results/`. It never uses API keys or
an author's existing manuscript. Set `OPENAUTHOR_TEST_PYTHON` to select a Python
executable; `OPENAUTHOR_BROWSER_EXECUTABLE` optionally selects an installed browser.

This gate complements the native Rust bridge tests. It does not certify Tauri
packaging, live-provider creative quality, microphone hardware, or mobile devices.

## Local setup

```bash
make setup
pip install -e .
make install-desktop
make desktop-prereq
```

## Build a local application bundle

```bash
make runtime-prepare
make runtime-check
make macos-bundle
make macos-bundle-check
```

`runtime-prepare` downloads pinned python-build-standalone and Codex assets, verifies their recorded checksums, installs the openAuthor core, and builds checksum-pinned Git source on the native architecture. Git's license and corresponding source ship alongside the binary. Runtime verification exercises Storylines and backup recovery with system tools absent from PATH. The Tauri build fails closed when a required runtime is missing. Build and verify each architecture locally on its matching Mac. Distribution additionally requires Developer ID signing, Apple notarization, and the installation checks in [macOS release setup](macos-release-setup.md). Packaging and publishing are manual; GitHub Actions is disabled.

## Smoke checklist (macOS)

1. Run release smoke gates:

```bash
make desktop-smoke
```

2. Start app in dev shell:

```bash
make desktop-tauri
```

3. Validate launch and project load:
- Choose `New Project`, enter a name and save location, and create it.
- Close it and use `Open Project` to select the same folder.
- Expect: the workbench opens and the manuscript list loads without terminal interaction.

4. Validate core authoring actions:
- Create a scene, edit body, save.
- Generate a local proposal, review it, and apply it.
- Use `Undo change` and confirm the original scene body is restored; the undo itself must create a new revision.
- Create a second proposal and reject it.
- Comment on one hunk, request a revision, and confirm the author feedback remains attached to its provenance.
- Select at least two scenes in the Change Set composer, generate a coordinated revision, review each scene, and apply the group as one Revision.
- Expect success messages, refreshed lists, and the applied body in the editor.

5. Validate AI run workflow:
- Generate proposal from desktop (`local` provider minimum).
- In Settings, choose `Sign in with ChatGPT`, complete the official browser flow, and confirm the card shows the account's ChatGPT plan.
- Create an Assistant thread with `ChatGPT Subscription`, send a message, and generate one reviewed Change Set. Confirm no `OPENAI_API_KEY` is set for this path.
- Sign out and confirm openAuthor's card disconnects without changing the normal Codex CLI login.
- Optionally set retrieval mode to `required` after `openauthor retrieval build --json` and confirm cited context in Assistant chat.
- Open `Runs` and confirm the basic history row reports provider, status, quality, cost, and latency.
- Advanced rerun, comparison, pinning, export, and run-detail provenance are not active V2 release checks.

6. Validate reference workflows:
- Create and edit a Codex entity.
- Scan Story Memory, correct a suggestion, then exercise bulk accept, review-later, and exclude.
- Search for both scene prose and the Codex entity.
- Open Inspector and confirm the selected scene's status, POV, word count, summary, and proposals.

7. Validate continuity + navigation:
- Run continuity checks.
- Jump to scene from checks and context actions.

8. Validate Storyline experiments:
- Create a Storyline with a hypothesis, protected constraints, scope, and success criteria; edit multiple scenes and return to Primary.
- Compare scene, arc, Canon Fact, setup/payoff, open-question, and word-count impact.
- Prepare selected differences as coordinated Change Sets and confirm unresolved conflicts do not silently mutate Primary.

9. Validate CLI-only hardening gates:
- The deeper workspace and performance diagnostics are intentionally not exposed in the active V2 UI.
- Run against the same project root:
  - `openauthor check startup --json`
  - `openauthor check startup --repair --json`
  - `openauthor check workspace --json`
  - `openauthor check workspace --repair --json`
  - `openauthor check performance --repeat 3 --json`
- Run the deterministic large-project budget gate: `make test-scale`.
- Run the measured Canon and Editorial gates: `make test-canon-eval` and `make test-editorial-eval`.

10. Record known product gaps:
- The product provides ordinary-edit Revisions, named versions, portable verified backups, revision undo, staged Markdown/TXT/DOCX/Scrivener import, Markdown/DOCX export, recovery drafts, startup repair, and embedded runtimes. Local arm64 native GUI smoke evidence is recorded in `docs/reliability-delivery.md`; credential-verified signed/notarized artifacts, both-architecture clean-machine evidence, and an unattended packaged GUI gate remain unverified.
- Do not approve a public release solely because this manual checklist and unit gates pass.

11. Drill scene recovery:
- Edit a scene and terminate the development app before the two-second autosave completes.
- Relaunch, reopen the scene, and confirm the recovery banner offers `Restore` and `Discard`.
- Restore, save, relaunch again, and confirm the journal no longer prompts.

## Failure diagnostics

- `Project load failed: ... Verify the project root and retry.`
  - Check path exists and contains `.openauthor/project.json`.
- `Proposal generation failed: ... Check provider credentials/settings and retry.`
  - Validate `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` as needed.
- `Codex runtime is unavailable.`
  - Packaged builds should contain `Contents/Resources/resources/runtime/codex/bin/codex`.
  - In development, install Codex or set `OPENAUTHOR_CODEX_BIN` to a compatible executable.
- `The ... model requires a newer version of Codex.`
  - Re-run `make runtime-prepare` to restore the pinned runtime, or update the development Codex CLI before retrying.
- `Proposal generation blocked by budget policy.`
  - Inspect policy/usage with `openauthor generation budget --json`.
  - Adjust limits with `openauthor generation budget --max-... --daily-... --weekly-... --json`.
  - Reset limits with `openauthor generation budget --reset --json`.
- `Proposal generation failed: Retrieval ...`
  - If retrieval mode is `required`, ensure index exists and is fresh:
    - `openauthor retrieval status --json`
    - `openauthor retrieval build --json`
- `Pinned run ... is stale. Clear the pin to recover.`
  - Use `Clear Stale Pin` in Context tab or `generation unpin`.
- `Retrieval index is stale for current project state. Rebuild before querying.`
  - Inspect index state: `openauthor retrieval status --json`.
  - Rebuild index: `openauthor retrieval build --json`.
  - Re-run query with fail-closed mode: `openauthor retrieval query --text "..." --require-fresh --json`.
- `Workspace audit found retrieval index stale/missing/invalid`
  - Run `openauthor retrieval build --json`.
- `Workspace audit found stale generation pins`
  - Run `openauthor check workspace --repair --json` or manually unpin per scene.
- Tauri startup failure (Rust/toolchain):
  - Re-run `make desktop-prereq`.
  - Re-run `make tauri-check` for compile diagnostics.

## Upgrade path

1. Pull latest repository changes.
2. Refresh Python and Node dependencies:
   - `pip install -e .`
   - `make install-desktop` (use `make install-js` for voice/mobile development)
3. Run `make desktop-smoke`.
4. Run `make test-scale`.
5. If either gate fails, fix prerequisites or regressions before attempting packaging.
