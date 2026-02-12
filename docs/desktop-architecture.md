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
- Proposal review triage (client-side): queue modes for selected-scene/prioritized preferred-linked/only preferred-linked plus status filtering; list rendering is windowed with explicit "load more" actions for larger queues.

## Implemented command usage (Codex Panel)

- Codex list: `codex list --json`
- Codex create: `codex add --type ... --name ... --description ... --json`
- Codex fetch: `codex get --id <entity-id> --json`
- Codex update: `codex update --id <entity-id> ... --json`
- Runtime codex behavior: codex mutations keep `codex/codex.json` synchronized, and branch switch/merge syncs SQLite runtime state from branch snapshot.

## Implemented command usage (Continuity Checks)

- Continuity scan: `check continuity --json`

## Implemented command usage (Context Lens)

- Scene context: derived from loaded `scene get --id <scene-id> --json`
- Proposal context: derived from `proposal list --json`
- Codex context: derived from `codex list --json`
- Continuity context: derived from `check continuity --json`
- Preferred pipeline context: derived from `generation pins --json` + `generation get --id <run-id> --json` + `proposal list --json`, including stale-pin detection and recovery actions.

## Implemented command usage (Generation Runs)

- Run list: `generation list --json` (supports status + provider + quality filters)
- Run detail: `generation get --id <run-id> --json`
- Run rerun: `generation rerun --id <run-id> [--retrieval-mode ... --retrieval-limit ... --retrieval-min-score ... --retrieval-require-fresh|--retrieval-allow-stale] --json`
- Run pin: `generation pin --scene <scene-id> --run <run-id> --json`
- Run unpin: `generation unpin --scene <scene-id> --json`
- Run pins list: `generation pins --json`
- Runtime config: `generation config --json`
- Budget policy inspection/update: `generation budget [--reset|--max-...|--daily-...|--weekly-...] --json`
- Proposal generation supports retrieval-backed mode (`--retrieval-mode off|auto|required`) and writes citation provenance into run/proposal generation payloads.
- Desktop run detail actions: pin/unpin preferred run, re-run with override controls (including retrieval overrides), baseline run selection + compare-to-previous (same scene), recommendation-guided promote actions (current vs baseline), selectable weighting profiles, persisted comparison preferences per project root, copy/download log JSON, copy/download comparison reports (JSON + Markdown), generation budget policy view/update/reset controls with daily/weekly usage readout, and retrieval provenance viewer panels (query/index/citations). Proposal review also surfaces generation-level retrieval citations and can jump directly to preferred proposal for a scene.

## Implemented command usage (Branch Workspace CLI primitives)

- Branch list: `branch list --json`
- Branch create/switch: `branch create --name ... [--from ...] --json`, `branch switch --name ... --json`
- Branch diff: `branch diff --base ... --head ... --json`
- Merge preflight: `branch preflight --base ... --head ... --json` (overlap/risk classification for scene/proposal/codex/project/budget artifacts)
- Merge apply: `branch merge --base ... --head ... --json` (auto-aborts on conflict and reports failure)
- Desktop Guided Merge panel uses the same branch list/create/switch/diff/preflight/merge command boundary.

## Implemented command usage (Retrieval Core)

- Retrieval index status: `retrieval status --json`
- Retrieval index build: `retrieval build [--chunk-words ... --overlap-words ...] --json`
- Retrieval query: `retrieval query --text ... [--limit ... --min-score ... --require-fresh] --json`
- Retrieval index metadata is commit/source scoped (`git_head` + `source_digest`) so stale indexes are explicit and query callers can fail closed with `--require-fresh`.

## Implemented workflow (Voice Command Substrate)

- Push-to-talk command capture uses browser SpeechRecognition when available (graceful fallback when unavailable).
- Manual transcript command input is available as fallback and shares the same parser/router path.
- Command grammar routes high-frequency intents to existing app actions (save scene, generate proposal, run checks, open tabs/views, open scene by id).
- Transcript audit log is persisted per project root in desktop local storage for operator review/replay.

## Why sidecar-first

- Reuses the already-tested Python core immediately.
- Keeps product momentum while desktop UX evolves.
- Avoids premature porting risk before user workflows stabilize.

## Migration path

When the command surface is stable, move command-by-command from Python into Rust while preserving frontend request/response shapes.

## Operations

- Release/runbook and macOS smoke process live in `docs/desktop-runbook.md`.
- Toolchain/runtime prerequisite validation is available via `make desktop-prereq`.
