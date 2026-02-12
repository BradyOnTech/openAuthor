# Desktop Architecture (v1)

## Stack

- Shell: Tauri
- UI: React + Vite
- Core engine: existing Python package (`openauthor`)

## Boundary contract

- Frontend calls Tauri commands:
  - `project_status(project_root)`
  - `core_command(project_root, args[])`
- Tauri backend executes:
  - `python3 -m openauthor <args...>`
  - Working directory is set to `project_root`

## Implemented command usage (Binder + Editor + Outliner)

- Binder list: `scene list --json`
- Scene load: `scene get --id <scene-id> --json`
- Scene save: `scene update --id <scene-id> ... --json`
- Scene create: `scene add ...`

## Implemented command usage (Proposal Review)

- Proposal list: `proposal list --json`
- Proposal create: `proposal add --title ... --instruction ... --scene ... --json`
- Proposal generate: `proposal generate --scene ... --instruction ... --provider ... --json`
- Proposal fetch: `proposal get --id <proposal-id> --json`
- Proposal apply: `proposal apply --id <proposal-id> --json`
- Proposal reject: `proposal reject --id <proposal-id> --json`

## Implemented command usage (Codex Panel)

- Codex list: `codex list --json`
- Codex create: `codex add --type ... --name ... --description ... --json`
- Codex fetch: `codex get --id <entity-id> --json`
- Codex update: `codex update --id <entity-id> ... --json`

## Implemented command usage (Continuity Checks)

- Continuity scan: `check continuity --json`

## Implemented command usage (Context Lens)

- Scene context: derived from loaded `scene get --id <scene-id> --json`
- Proposal context: derived from `proposal list --json`
- Codex context: derived from `codex list --json`
- Continuity context: derived from `check continuity --json`

## Implemented command usage (Generation Runs)

- Run list: `generation list --json` (supports status + provider + quality filters)
- Run detail: `generation get --id <run-id> --json`
- Run rerun: `generation rerun --id <run-id> --json`
- Runtime config: `generation config --json`
- Desktop run detail actions: re-run with override controls, baseline run selection + compare-to-previous (same scene), copy/download log JSON, copy/download comparison reports (JSON + Markdown)

## Why sidecar-first

- Reuses the already-tested Python core immediately.
- Keeps product momentum while desktop UX evolves.
- Avoids premature porting risk before user workflows stabilize.

## Migration path

When the command surface is stable, move command-by-command from Python into Rust while preserving frontend request/response shapes.
