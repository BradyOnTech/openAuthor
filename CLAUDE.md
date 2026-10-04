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

## Environment Variables

- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — for real AI provider calls
- `OPENAUTHOR_PROVIDER_MAX_RETRIES` (default `2`) — provider retry count
- `OPENAUTHOR_PROVIDER_RETRY_BASE_MS` (default `350`) — retry backoff base
