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

## Workspace and navigation state ownership

- `WorkspaceProvider` owns the active workspace/project identity, project root, loaded project collections, and native command lifecycle.
- `EditorProvider` is keyed by active project id. Switching or creating a novel remounts editor state, so tabs and scene data cannot leak across books.
- `UIProvider` owns shell visibility and the selected activity/secondary destination. Project changes reset the shell to Manuscript with optional panels closed.
- `useWorkspaceNavigation` is the single author-facing routing boundary for the activity rail, keyboard shortcuts, command palette, and onboarding. Destinations that represent workspaces open their matching center tab; Manuscript selects an already-open scene or loads the first scene.
- Sidebars render state and invoke navigation; they do not mutate center tabs as a render side effect.
- Chat and Inspector are optional secondary tools. They start closed and share a visible close control so the manuscript remains the default center of gravity.

## Capability interpretation

The command inventory below describes implemented core and bridge contracts. It is not, by itself, a claim that every command has a complete active V2 workflow. Product exposure and release state are authoritative in [`capabilities.json`](capabilities.json), with a human-readable explanation in [`capabilities.md`](capabilities.md).

## Implemented command usage (Binder + Editor + Outliner)

- Binder list: `scene list --json`
- Scene load: `scene get --id <scene-id> --json`
- Scene save: `scene update --id <scene-id> ... --json`
- Scene create: `scene add ...`

## Implemented command usage (Manuscript Interchange)

- Structure preview: `manuscript preview --source ... --strategy auto|files|headings|single --json`
- Staged import: `manuscript import --source ... --strategy ... --json`
- Loss-reporting export: `manuscript export --format markdown|docx --target ... --json`
- Preview is read-only. Import stages every scene before moving any into the project and removes already-moved files if a filesystem commit fails.

## Implemented command usage (Proposal Review)

- Proposal list: `proposal list --json`
- Proposal create: `proposal add --title ... --instruction ... --scene ... --json`
- Proposal generate: `proposal generate --scene ... --instruction ... --provider ... --json`
- Proposal fetch: `proposal get --id <proposal-id> --json`
- Proposal apply: `proposal apply --id <proposal-id> --json`
- Proposal undo: `proposal undo --id <proposal-id> --json`
- Proposal reject: `proposal reject --id <proposal-id> --json`
- Apply requires drafted scene text, fails closed if before/after revisions cannot be recorded, and stores stable revision refs. Undo refuses to overwrite newer scene work unless explicitly forced.
- Proposal review triage (client-side): queue modes for selected-scene/prioritized preferred-linked/only preferred-linked plus status filtering; list rendering is windowed with explicit "load more" actions for larger queues.

## Implemented command usage (Codex Panel)

- Codex list: `codex list --json`
- Codex create: `codex add --type ... --name ... --description ... --json`
- Codex fetch: `codex get --id <entity-id> --json`
- Codex update: `codex update --id <entity-id> ... --json`
- Runtime codex behavior: codex mutations keep `codex/codex.json` synchronized, and branch switch/merge syncs SQLite runtime state from branch snapshot.

## Implemented command usage (Continuity Checks)

- Continuity scan: `check continuity --json`
- Workspace drift audit: `check workspace [--repair] --json`
- Performance baseline: `check performance [--repeat ...] --json`

## Core command usage (context helpers)

- Scene context: derived from loaded `scene get --id <scene-id> --json`
- Proposal context: derived from `proposal list --json`
- Codex context: derived from `codex list --json`
- Continuity context: derived from `check continuity --json`
- Preferred pipeline context: derived from `generation pins --json` + `generation get --id <run-id> --json` + `proposal list --json`, including stale-pin detection and recovery actions.

## Implemented command usage (Chat Workspace)

- Thread list/create/get/rename/update:
  - `chat thread list --json`
  - `chat thread create --title ... --provider ... --model ... --mode chat|agent --json`
  - `chat thread get --id ... --json`
  - `chat thread rename --id ... --title ... --json`
  - `chat thread update --id ... [context/profile flags] --json`
- Message flow:
  - `chat send --thread ... --message ... [context drawer flags] --json`
  - `chat message list --thread ... [--limit ...] --json`
- Agent pending tool execution:
  - `chat tool execute --thread ... --message ... --index ... --json`

## Core command usage (Generation Runs)

- Run list: `generation list --json` (supports status + provider + quality filters)
- Run detail: `generation get --id <run-id> --json`
- Run rerun: `generation rerun --id <run-id> [--retrieval-mode ... --retrieval-limit ... --retrieval-min-score ... --retrieval-require-fresh|--retrieval-allow-stale] --json`
- Run pin: `generation pin --scene <scene-id> --run <run-id> --json`
- Run unpin: `generation unpin --scene <scene-id> --json`
- Run pins list: `generation pins --json`
- Runtime config: `generation config --json`
- Budget policy inspection/update: `generation budget [--reset|--max-...|--daily-...|--weekly-...] --json`
- Proposal generation supports retrieval-backed mode (`--retrieval-mode off|auto|required`) and writes citation provenance into run/proposal generation payloads.
- Active V2 exposes a basic read-only run history and separate budget controls. Rerun, pinning, comparison/export, and run-level provenance commands/helpers remain core capabilities without a current product workflow.

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
- Retrieval index metadata is Revision/source scoped so stale indexes are explicit and query callers can fail closed with `--require-fresh`. The serialized `git_head` key is retained for compatibility but now carries the current internal Revision id; advanced Git-backed Storylines remain a separate adapter.

## Hidden helper capability (Voice Command + Dictation)

- Push-to-talk command capture uses browser SpeechRecognition when available (graceful fallback when unavailable).
- Manual transcript command input is available as fallback and shares the same parser/router path.
- Command grammar routes high-frequency intents to existing app actions (save scene, generate proposal, run checks, open tabs/views, open scene by id).
- Voice mode includes command mode and dictation mode:
  - Command mode supports confirmation-before-execute and undo affordances for reversible actions.
  - Dictation mode captures transcript for a selected scene and emits a proposal artifact (never direct scene mutation).
- Transcript audit log is persisted per project root in desktop local storage for operator review/replay, including confirm/discard outcomes.
- Voice is intentionally absent from the active V2 navigation while the trusted Change Set loop and real undo are unfinished.

## CLI release tooling (Hardening + Scale)

- Workspace drift audit (`check workspace`) reports branch drift, retrieval freshness/schema issues, and stale generation pin references.
- Optional safe repair (`check workspace --repair`) clears stale pin references / resets invalid pin metadata.
- Performance baseline (`check performance`) captures repeatable timing samples for scene/proposal/run list workloads plus retrieval status.
- `make test-scale` builds a deterministic 400-scene fixture and enforces budgets from `docs/performance-budgets.json`.
- These tools are CLI/CI gates and are not visible V2 product features.

## Why sidecar-first

- Reuses the already-tested Python core immediately.
- Keeps product momentum while desktop UX evolves.
- Avoids premature porting risk before user workflows stabilize.

## Migration path

When the command surface is stable, move command-by-command from Python into Rust while preserving frontend request/response shapes.

## Operations

- Release/runbook and macOS smoke process live in `docs/desktop-runbook.md`.
- Toolchain/runtime prerequisite validation is available via `make desktop-prereq`.
- Native bridge integration coverage is available via `make tauri-test`; rendered application automation is still a release gap.
