# openAuthor

Local-first fiction authoring foundation with:

- Git-native manuscript project structure
- Markdown scene files with metadata
- SQLite-backed codex entities
- Proposal queue for AI-assisted edits

Architecture note: desktop v1 will use `Tauri + React`, with Tauri invoking the existing Python core as a sidecar process. This keeps momentum while preserving a clean migration path later.

## Quick start

```bash
make setup
make check
make audit-no-mocks
make test
make test-desktop
make test-all
```

## Desktop shell

`Tauri + React` scaffold lives in `desktop`.
Current desktop slice: Binder + Editor + Outliner + Proposal Review + Generation Runs + Context Lens + Codex Panel + Continuity Checks.

```bash
cd desktop
npm install
npm run tauri:dev
```

See `desktop/README.md` and `docs/desktop-architecture.md`.

## CLI usage

Run all commands with `python3 -m openauthor ...` (or install via `pip install -e .` and use `openauthor`).

```bash
# initialize in current folder
python3 -m openauthor init .

# add and list scenes
python3 -m openauthor scene add --title "Opening Scene" --summary "Introduce protagonist" --pov "Elara"
python3 -m openauthor scene list
python3 -m openauthor scene list --json
python3 -m openauthor scene get --id scene-0001 --json
python3 -m openauthor scene update --id scene-0001 --summary "Tighter opening" --body "Updated body" --json

# add and list codex entities
python3 -m openauthor codex add --type character --name "Elara" --description "Main POV character"
python3 -m openauthor codex list --type character
python3 -m openauthor codex list --json
python3 -m openauthor codex get --id entity-xxxxxxxxxxxx --json
python3 -m openauthor codex update --id entity-xxxxxxxxxxxx --description "Updated profile" --json

# create and apply proposal cards
python3 -m openauthor proposal add --title "Tighten prose" --instruction "Make paragraph one more direct" --scene scene-0001
python3 -m openauthor proposal list --status pending
python3 -m openauthor proposal apply --id proposal-xxxxxxxxxxxx

# generate proposal using local provider (real deterministic adapter)
python3 -m openauthor proposal generate --scene scene-0001 --instruction "Tighten pacing and keep POV voice" --provider local --json

# generate proposal using OpenAI or Anthropic (requires API keys)
OPENAI_API_KEY=... python3 -m openauthor proposal generate --scene scene-0001 --instruction "Improve dialogue clarity" --provider openai --model gpt-4.1-mini --json
ANTHROPIC_API_KEY=... python3 -m openauthor proposal generate --scene scene-0001 --instruction "Increase tension" --provider anthropic --json

# inspect generation runs and failures
python3 -m openauthor generation list --json
python3 -m openauthor generation list --status failed --json
python3 -m openauthor generation list --provider openai --json
python3 -m openauthor generation list --quality low --json
python3 -m openauthor generation get --id gen-xxxxxxxxxxxx --json
python3 -m openauthor generation rerun --id gen-xxxxxxxxxxxx --json
python3 -m openauthor generation config --json

# create git snapshot
python3 -m openauthor snapshot create -m "Draft scene and codex seed"
python3 -m openauthor snapshot log

# run continuity checks
python3 -m openauthor check continuity
python3 -m openauthor check continuity --json
```

`snapshot create` stages only authoring artifacts:

- `manuscript/scenes/`
- `.openauthor/project.json`
- `.openauthor/proposals/`
- `codex/codex.json` (exported from SQLite on snapshot)

AI generation artifacts:

- `.openauthor/generations/*.json` stores prompt/context/usage logs per run.
- `.openauthor/provider_pricing.json` controls model pricing for cost estimation metadata.
- Failed provider calls are also logged to `.openauthor/generations/*.json` with error category metadata.
- Logs include normalization diagnostics (detected headers, filled sections, changed/unchanged normalization).
- Logs and summaries include quality scoring metadata (`quality_score`, `quality_tier`, `quality_flags`).
- Logs also persist generation settings (`temperature`, `max_output_tokens`, `context_scene_radius`, `codex_limit`) for reproducible reruns.
- Desktop Runs panel supports one-click re-run plus log JSON copy/download actions for audit/debug workflows.

Generated proposal format is normalized to four sections for review consistency:

- `Intent`
- `Constraints`
- `Edit Plan`
- `Continuity Notes`

Provider retry tuning (optional env vars):

- `OPENAUTHOR_PROVIDER_MAX_RETRIES` (default `2`)
- `OPENAUTHOR_PROVIDER_RETRY_BASE_MS` (default `350`)

## Repository layout

```text
.
├── openauthor/             # core project engine + CLI
├── desktop/                # Tauri + React shell
├── tests/                  # end-to-end CLI flow tests
├── manuscript/scenes/      # scene markdown files
├── codex/codex.sqlite3     # local runtime DB (ignored)
├── codex/codex.json        # versionable codex snapshot artifact
├── .openauthor/            # project metadata + proposals
└── docs/                   # brief + implementation plan
```

## Status

Phase 0 and Phase 1 are complete. Phase 3 (desktop UX) is in progress with Binder + Editor + Outliner + Proposal Review + Context Lens + Codex Panel + Continuity Checks implemented. See `docs/plan.md`.
