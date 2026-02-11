# Implementation Plan

## Phase 0: Bootstrap (completed)

- Initialize git repository.
- Add base repository conventions (`.gitignore`, `.editorconfig`, `.gitattributes`).
- Add foundational docs and project commands.

## Phase 1: Core engine (completed)

- Import and normalize requirements into `docs/brief.md`. ✅
- Build local-first project engine (`openauthor` package). ✅
- Implement CLI workflows:
  - `init` ✅
  - `scene add/list` ✅
  - `codex add/list` ✅
  - `proposal add/list/apply/reject` ✅
  - `snapshot create/log` ✅
- Add end-to-end CLI test coverage. ✅
- Scope snapshots to authoring artifacts only (avoid repo-wide `git add -A`). ✅
- Export codex to deterministic JSON for version history (`codex/codex.json`). ✅

## Phase 2: AI integration layer (pending)

- Add provider abstraction (`openai`, `anthropic`, `local` adapters).
- Implement prompt/context packer from scenes + codex.
- Add proposal-generation command (`proposal generate`) with deterministic logs.
- Add budget/cost and token accounting metadata.

## Phase 3: Desktop UX (in progress)

- Build Tauri shell + editor/outliner views.
  - Binder + Editor implemented in desktop shell ✅
  - Outliner view (search/filter/open-in-editor) ✅
- Establish desktop/core contract:
  - Tauri commands as UI boundary
  - Python core called as sidecar process for v1 ✅
  - Typed request/response payloads for future Rust migration ✅
- Add proposal review pane and context lens UI.
  - Proposal review pane (create/list/apply/reject) ✅
  - Context lens UI (scene-linked proposal/codex/continuity context) ✅
- Add codex panel and continuity checks panel.
  - Codex panel (create/list/edit entities) ✅
  - Continuity checks panel (run/list/jump-to-scene) ✅

## Testing Strategy (active)

- Python unit tests:
  - Target module-level behavior (`scenes`, `proposals`, `codex`, `git_ops` helpers).
  - Favor deterministic tests around parsing, serialization, and status transitions.
- Python CLI regression tests:
  - End-to-end command flows in temp project dirs.
  - Add a test per new CLI contract (especially `--json` outputs used by desktop).
- Desktop unit tests (TypeScript):
  - Test pure state helpers/selectors and command-argument builders.
  - Keep these fast and independent of Tauri runtime.
- Desktop integration checks:
  - `npm run build` and `cargo check` for compile-time regression gates.
  - Promote to CI once workflow is stable.

## Current test gates

- `make test` for Python CLI/unit tests.
- `npm run build` in `desktop/` for TypeScript + Vite.
- `cargo check --manifest-path desktop/src-tauri/Cargo.toml` for Tauri backend integrity.

## Phase 4: Advanced workflows (pending)

- Experiment branches with guided merge UX.
- Retrieval index and provenance/citation UI.
- Voice-first commands and dictation mode.

## Definition of done for MVP

- Core flow works locally from a clean clone.
- Basic tests pass.
- Setup and usage are documented.
