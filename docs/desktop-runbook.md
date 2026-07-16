# Desktop Runbook (macOS-first)

## Release profile

- Platform: macOS first (`aarch64` + `x86_64`).
- Packaging path: Tauri bundle output from `desktop/src-tauri/target/release/bundle/`.
- Runtime: pinned Python 3.11 standalone distribution with openAuthor installed inside the app bundle; users do not install Python.
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
- Node.js 20+
- Rust stable toolchain (`cargo`, `rustc`)
- macOS build dependencies required by Tauri/WebKit

Validation command:

```bash
make desktop-prereq
```

## Local setup

```bash
make setup
pip install -e .
cd desktop && npm install && cd ..
make desktop-prereq
```

## Build a local application bundle

```bash
make runtime-prepare
make runtime-check
make macos-bundle
make macos-bundle-check
```

`runtime-prepare` downloads a pinned python-build-standalone asset and verifies its SHA-256 checksum before installing the openAuthor core. The Tauri build fails closed when the runtime is missing. Local bundles are not distributable releases: the `release-macos` workflow requires Apple Developer ID credentials, signs and notarizes both architectures, and verifies the sealed bundle before leaving artifacts in a draft prerelease.

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
- The current product now provides one-click revision undo, staged Markdown/TXT/DOCX/Scrivener import, Markdown/DOCX export, crash recovery, startup repair, and a verified embedded Python runtime. It does not yet provide credential-verified signed/notarized artifacts, both-architecture clean-machine evidence, or rendered packaged-app automation.
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
   - `cd desktop && npm install && cd ..`
3. Run `make desktop-smoke`.
4. Run `make test-scale`.
5. If either gate fails, fix prerequisites or regressions before attempting packaging.
