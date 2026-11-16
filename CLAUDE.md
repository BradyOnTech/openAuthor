# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# Python core
pip install -e .                    # editable install
make test                           # Python unittest suite
PYTHONPATH=. python3 -m unittest tests/test_scenes.py  # single test file

# Desktop (Tauri + React)
cd desktop && npm install           # install deps
make test-desktop                   # vitest suite
cd desktop && npx vitest run src/budget.test.ts  # single test file
make desktop-web                    # Vite dev server (no Rust needed)
make desktop-tauri                  # full Tauri desktop app

# Combined
make test-all                       # Python + desktop tests
make desktop-smoke                  # full release gates (prereqs + tests + build + tauri-check)

# Quick validation
make demo                           # minimal CLI workflow (init + add scene + list)

# Quality
make check                          # repo integrity + no-mock audit
make audit-no-mocks                 # fail on TODO/FIXME/TBD/NotImplemented/stubbed/mock markers
```

## Architecture

**Sidecar pattern**: Tauri backend invokes `python3 -m openauthor <args>` as a subprocess and parses JSON output. The Python core has zero runtime dependencies (pure stdlib). The desktop shell is a thin UI over CLI commands.

**Two runtimes, one repo** (not a monorepo):
- `openauthor/` — Python 3.11+ core engine (CLI, scenes, codex, proposals, AI providers, git ops, retrieval, budget)
- `desktop/` — Tauri 2 + React 19 + TypeScript 7 frontend; `desktop/src-tauri/src/lib.rs` bridges to Python

**Storage model**:
- Scene files: `manuscript/scenes/*.md` (markdown with YAML frontmatter, git-versioned)
- Codex: `codex/codex.sqlite3` (runtime, gitignored) + `codex/codex.json` (versioned snapshot, auto-synced on mutations and branch ops)
- Proposals/chats: `.openauthor/workspace/` (gitignored)
- Generation logs: `.openauthor/generations/*.json` (full provenance)
- Retrieval index: `.openauthor/retrieval/index.json` (gitignored)
- Revision history: `.openauthor/revisions/` holds records (a manifest delta against the parent, with a full manifest at bounded intervals) and zlib-packed objects (`<digest>.z`, optionally stored against one earlier version of the same file). Read manifests only through `revisions._full_manifest`. Older full-manifest records and plain objects stay readable forever and are never rewritten; see `docs/manuscript-transactions.md`

**Python module map**:
- `cli.py` — argument parsing, command dispatch
- `scenes.py` — scene CRUD, frontmatter parsing
- `codex.py` — entity store (SQLite + JSON sync)
- `proposals.py` — proposal queue lifecycle
- `ai.py` — provider abstraction (local/openai/anthropic), retry/backoff
- `generations.py` — generation run logging, quality scoring, pinning
- `budget.py` — fail-closed token/cost budget enforcement
- `retrieval.py` — local retrieval index (TF-IDF chunks)
- `git_ops.py` — snapshot commits, branch ops, merge
- `chat.py` — chat thread persistence
- `checks.py` / `hardening.py` — continuity checks, workspace drift audit, perf baselines

**AI provider abstraction** (`openauthor/ai.py`): Pluggable `local` (deterministic, used in tests), `openai`, `anthropic` providers with retry/backoff and fail-closed budget enforcement.

**Proposal-based edits**: AI never silently mutates content. All AI output goes through a proposal queue (add/generate → draft → review → apply/reject). Generated proposals are normalized to four sections: Intent, Constraints, Edit Plan, Continuity Notes. `proposal draft` asks a provider for the full revised scene body (`proposed_body`); `proposal apply` writes it to the scene after a pre-apply snapshot, refusing stale drafts unless `--force`.

**Manuscript transactions**: Scene/proposal/revision and Storyline operations share a reentrant, cross-process project lock. Hold it from the initial read through commit or rollback; do not add per-screen locks or hold it across provider calls. See `docs/manuscript-transactions.md` for the interface, lock ordering, tested coverage and remaining limits. Advisory locking is not crash recovery or stale-editor conflict detection.

**Editor preconditions**: Desktop prose and Inspector saves send the `edit_version` returned by `get_scene` through `scene update --expected-version`. `scene_edits.save_scene_edit` compares submitted fields and Storyline scope under the project lock and archives conflicts without replacing the manuscript. Never substitute a freshly fetched version for a dirty editor's loaded version without explicit review. Internal `update_scene` and legacy CLI updates without the flag do not provide this check.

**Failure reporting**: Unexpected exceptions never reach the author as tracebacks: the CLI prints one `error:` line (exit 1) and the sidecar answers the failing request with category `internal_error` and keeps serving. Scene files are read as UTF-8 with a tolerated BOM; an undecodable file raises an `OpenAuthorError` naming it. A model response cut off at its output limit is rejected (`truncated_output`) for anything that becomes manuscript text; a cut-off chat reply is kept and flagged with `usage.truncated`.

**Stopping AI work**: The generation commands (`proposal generate`, `proposal draft`, hunk regeneration) are started with a cancel key (`generationCancelKey` in `desktop/src/api.ts`). Stop calls the native `cancel_core_commands`, which interrupts the engine process (SIGINT, then SIGKILL after 3 s) and reports status 130 with `error: Stopped.`. This relies on the crash-safety the core already has: atomic journaled writes, and a request id on every provider call so Retry recovers a saved reply. Give any new long-running command a cancel key rather than a second stop mechanism.

**Merge-conflict flow**: `branch conflicts` scans base...head for three-way conflicts without touching the worktree (git merge-file per overlapping path). `branch resolve --path <scene>` generates an AI-reconciled scene as a `merge_resolution` proposal; `branch merge --resolution <proposal-id>` performs the merge writing the reconciled content into conflicted files. Merges without resolutions still auto-abort on conflict.

## Key Conventions

- **Indent**: 2 spaces everywhere (`.editorconfig`)
- **Line endings**: LF only (`.gitattributes` enforces)
- **Local delivery**: Run verification, dependency audits, packaging, and signing locally. GitHub Actions and scheduled dependency updates are disabled by project policy; do not add hosted CI/CD workflows or dependency update automation unless the user requests it.
- **No placeholders in code**: `audit-no-mocks` scans for TODO/FIXME/TBD/NotImplemented/stubbed/mock markers and the local check will fail
- **CLI output**: all commands support `--json` for machine-readable output
- **Tests use `local` provider**: deterministic adapter, no API keys needed
- **Snapshot commits** stage only authoring artifacts: `manuscript/scenes/`, `.openauthor/project.json`, `codex/codex.json`, pricing/budget policy files

## Desktop Notes

- `desktop/src/AppV2.tsx` is the shell entry (rendered by `main.tsx`); UI lives in `desktop/src/components/` with state in `desktop/src/contexts/` (WorkspaceContext is the domain god-context)
- The legacy monolithic `App.tsx` was removed; helper libs it used (`voice*.ts`, `runCompare.ts`, `rerun.ts`, `runLog.ts`) remain with tests for the upcoming Voice/Runs panels
- `desktop/src/api.ts` wraps Tauri commands that call into Python
- `desktop/src/types.ts` has shared TypeScript interfaces (hand-maintained against CLI JSON)
- Panels: Runs, Merge (storyline branching/merge with AI conflict reconciliation), Budget (view/update/reset limits)
- Proposal flow in-app: `+ AI` in the Proposals sidebar opens the generate tab; proposal review supports Draft scene text → Apply to scene
- `createProjectRegistryClient()` returns the local registry under Vitest unless `VITE_PROJECT_REGISTRY=supabase` (keeps tests hermetic despite `.env.local`)
- Local storage persists per-project UI preferences (comparison profiles, voice transcripts)
- The prose page is `desktop/src/components/editor/ProseField.tsx`, a CodeMirror 6 editor whose document is the scene's Markdown text character for character: nothing is parsed and re-serialised, so saves stay byte-exact. Emphasis and scene breaks are drawn by `proseDecorations.ts` from the same rules the reader and Word export use (`proseEmphasis.ts`); `*`/`**` markers are hidden unless the caret or selection touches the phrase. Do not add a rich-text model or a Markdown round trip
- The editable element (role `textbox`, name "Scene prose") also exposes the part of the textarea interface callers and tests use: `value`, `selectionStart`/`selectionEnd`/`selectionDirection`, `setSelectionRange`, plus `replaceRange` and `revealPosition`. Assigning `value` is announced by the following `input`/`change` event, as for a textarea. Browser tests read it with `expectProse`/`proseValue` (`desktop/e2e/prose.ts`, `e2e/support/prose.ts`); `toHaveValue` does not apply
- Editor state is kept per scene (`stateKey`) across remounts, so undo history and the caret survive a tab switch and a save. Text arriving from outside that differs by more than trailing whitespace starts a fresh history. `SceneEditor` ignores its own tab mirror (`mirroredSceneRef`) so a keystroke is never replaced by an older copy of the scene
- Editor extras live beside it: smart punctuation and `Cmd+I` (`smartTypography.ts`), emphasis kept from pasted HTML (`pastedProse.ts`), author-chosen text size (`proseSize.ts`, `--prose-size`), find and replace (`FindBar.tsx`, highlights are editor decorations), and in focus mode paragraph dimming with typewriter scrolling
- App shortcuts use `primaryModifier` (`platformKeys.ts`): Command only on a Mac, where Control+letter keys are caret and deletion keys inside the editor
- Keep `Cmd+Shift+Z` unbound: it is Redo. Focus mode is `Cmd+Shift+D`
- The native menu bar (`desktop/src-tauri/src/menu.rs`) is a table of shortcuts; choosing an item dispatches an `openauthor-menu` DOM event on the window (no Tauri event module or permission involved) and `desktop/src/menuShortcuts.ts` replays it as a key press, so an action has one implementation (its key handler). Add a menu item by adding a table row for a shortcut the frontend already handles. Every shortcut must test `primaryModifier` from `platformKeys.ts`, never `metaKey || ctrlKey`
- Fonts are bundled through `@fontsource-variable/*` and imported in `main.tsx`; do not add remote font or asset URLs, the app must render fully offline
- The selection toolbar (`SelectionAssist`) is hidden until text is selected, then floats without shifting the prose; the prose focus ring shows only on keyboard arrival (`data-focus-ring`)

## Environment Variables

- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — for real AI provider calls
- `OPENAUTHOR_PROVIDER_MAX_RETRIES` (default `2`) — provider retry count
- `OPENAUTHOR_PROVIDER_RETRY_BASE_MS` (default `350`) — retry backoff base
- `OPENAUTHOR_LOCK_TIMEOUT_MS` (default `30000`) — how long a command waits for the project lock before failing with a clear message
- `OPENAUTHOR_DEBUG=1` — print tracebacks for unexpected errors; otherwise the CLI and sidecar report one `error:` line
- `OPENAUTHOR_PROJECTS_DIR` (default `~/Documents/openAuthor`) — where `project suggest-root` places new books; tests point it at a sandbox
