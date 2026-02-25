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
- `desktop/` — Tauri 2.0 + React 18 + TypeScript frontend; `desktop/src-tauri/src/lib.rs` bridges to Python

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

**Proposal-based edits**: AI never silently mutates content. All AI output goes through a proposal queue (add → review → apply/reject). Generated proposals are normalized to four sections: Intent, Constraints, Edit Plan, Continuity Notes.

## Key Conventions

- **Indent**: 2 spaces everywhere (`.editorconfig`)
- **Line endings**: LF only (`.gitattributes` enforces)
- **No placeholders in code**: `audit-no-mocks` scans for TODO/FIXME/TBD/NotImplemented/stubbed/mock markers and CI will fail
- **CLI output**: all commands support `--json` for machine-readable output
- **Tests use `local` provider**: deterministic adapter, no API keys needed
- **Snapshot commits** stage only authoring artifacts: `manuscript/scenes/`, `.openauthor/project.json`, `codex/codex.json`, pricing/budget policy files

## Desktop Notes

- `desktop/src/App.tsx` is the monolithic React component (very large file)
- `desktop/src/api.ts` wraps Tauri commands that call into Python
- `desktop/src/types.ts` has shared TypeScript interfaces
- Voice workspace: push-to-talk STT + dictation-to-proposal pipeline
- Local storage persists per-project UI preferences (comparison profiles, voice transcripts)

## Environment Variables

- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — for real AI provider calls
- `OPENAUTHOR_PROVIDER_MAX_RETRIES` (default `2`) — provider retry count
- `OPENAUTHOR_PROVIDER_RETRY_BASE_MS` (default `350`) — retry backoff base
