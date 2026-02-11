# Implementation Plan

## Phase 0: Bootstrap (completed)

- Initialize git repository.
- Add base repository conventions (`.gitignore`, `.editorconfig`, `.gitattributes`).
- Add foundational docs and project commands.

## Phase 1: Core engine (in progress)

- Import and normalize requirements into `docs/brief.md`. ✅
- Build local-first project engine (`openauthor` package). ✅
- Implement CLI workflows:
  - `init` ✅
  - `scene add/list` ✅
  - `codex add/list` ✅
  - `proposal add/list/apply/reject` ✅
  - `snapshot create/log` ✅
- Add end-to-end CLI test coverage. ✅

## Phase 2: AI integration layer (pending)

- Add provider abstraction (`openai`, `anthropic`, `local` adapters).
- Implement prompt/context packer from scenes + codex.
- Add proposal-generation command (`proposal generate`) with deterministic logs.
- Add budget/cost and token accounting metadata.

## Phase 3: Desktop UX (pending)

- Build Tauri shell + editor/outliner views.
- Add proposal review pane and context lens UI.
- Add codex panel and continuity checks panel.

## Phase 4: Advanced workflows (pending)

- Experiment branches with guided merge UX.
- Retrieval index and provenance/citation UI.
- Voice-first commands and dictation mode.

## Definition of done for MVP

- Core flow works locally from a clean clone.
- Basic tests pass.
- Setup and usage are documented.
