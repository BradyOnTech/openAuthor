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

- Python 3.10+ with editable core install (`pip install -e .`)
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
- Open `Runs`, inspect run detail, rerun with overrides.
- Pin/unpin preferred run.

6. Validate preferred pipeline triage:
- Open `Context` tab.
- Confirm health badge updates (missing/stale pin, proposal state).
- Use recovery actions (`Clear Stale Pin`, `Refresh Proposals`, `Open Generate Form`).

7. Validate continuity + navigation:
- Run continuity checks.
- Jump to scene from checks and context actions.

## Failure diagnostics

- `Project load failed: ... Verify the project root and retry.`
  - Check path exists and contains `.openauthor/project.json`.
- `Proposal generation failed: ... Check provider credentials/settings and retry.`
  - Validate `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` as needed.
- `Proposal generation blocked by budget policy.`
  - Inspect policy/usage with `openauthor generation budget --json`.
  - Adjust limits with `openauthor generation budget --max-... --daily-... --weekly-... --json`.
  - Reset limits with `openauthor generation budget --reset --json`.
- `Pinned run ... is stale. Clear the pin to recover.`
  - Use `Clear Stale Pin` in Context tab or `generation unpin`.
- `Retrieval index is stale for current project state. Rebuild before querying.`
  - Inspect index state: `openauthor retrieval status --json`.
  - Rebuild index: `openauthor retrieval build --json`.
  - Re-run query with fail-closed mode: `openauthor retrieval query --text "..." --require-fresh --json`.
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
