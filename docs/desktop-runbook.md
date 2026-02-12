# Desktop Runbook (macOS-first)

## Release profile

- Platform: macOS first (`aarch64` + `x86_64`).
- Packaging path: Tauri bundle output from `desktop/src-tauri/target/release/bundle/`.
- Gate required before packaging:
  - `make desktop-smoke`
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
- Enter valid `Project Root`.
- Click `Reload Project`.
- Expect: `Project Ready` status and scene list loads.

4. Validate core authoring actions:
- Create a scene, edit body, save.
- Create a manual proposal and apply/reject.
- Expect success messages and refreshed lists.

5. Validate AI run workflow:
- Generate proposal from desktop (`local` provider minimum).
- Optionally set retrieval mode to `required` after `openauthor retrieval build --json`.
- Open `Runs`, inspect run detail, rerun with overrides.
- Confirm retrieval provenance panel shows query/index/citation metadata for retrieval-enabled runs.
- Pin/unpin preferred run.

6. Validate preferred pipeline triage:
- Open `Context` tab.
- Confirm health badge updates (missing/stale pin, proposal state).
- Use recovery actions (`Clear Stale Pin`, `Refresh Proposals`, `Open Generate Form`).

7. Validate continuity + navigation:
- Run continuity checks.
- Jump to scene from checks and context actions.

8. Validate voice command + dictation workflow:
- In Voice Workspace, keep mode=`command` and run manual transcript commands (`open runs`, `run continuity checks`, `save scene`).
- Confirm command enters pending state when confirmation is enabled; use `Confirm` then `Undo Last` for reversible actions.
- Switch mode=`dictation`, select a scene, capture transcript, confirm execution, and verify a new proposal appears for that scene (no direct scene mutation).
- If SpeechRecognition is available, start/stop listening and confirm final transcripts queue/execute correctly.
- Confirm recent voice audit rows appear in the log.

9. Validate hardening workflows:
- In `Runs`, open Workspace Hardening and run `Run Drift Audit`.
- Optionally run `Audit + Repair` and confirm stale pin metadata is repaired when present.
- Run `Performance Baseline` with repeat=`2` or `3` and confirm metric rows populate.
- CLI parity check (same project root):
  - `openauthor check workspace --json`
  - `openauthor check workspace --repair --json`
  - `openauthor check performance --repeat 3 --json`

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
- `Voice capture unavailable in this runtime.`
  - Use manual transcript command input in Voice Command bar.
  - On macOS, ensure microphone permission is granted to the app runtime when using push-to-talk.
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
4. If smoke fails, fix prerequisites before attempting packaging.
