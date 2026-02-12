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

## Phase 2: AI integration layer (closeout in progress)

- 2.1 Provider abstraction:
  - Provider interfaces (`openai`, `anthropic`, `local`) with real adapter calls are implemented in core. ✅
  - Local provider uses deterministic generation; remote providers fail closed without credentials. ✅
  - Retry/backoff for transient provider failures and structured provider error categories are implemented. ✅
  - Runtime provider/retry config inspection is available via `generation config`. ✅
- 2.2 Prompt/context packing:
  - Deterministic context packs from selected scene + neighbors + codex + continuity checks are implemented. ✅
  - Saved generation artifacts for reproducible runs are implemented under `.openauthor/generations/`. ✅
- 2.3 Proposal generation:
  - `proposal generate` command persists generated proposals through existing proposal queue/storage. ✅
  - Provider/model and generation metadata are attached to proposal payloads. ✅
  - Desktop proposal panel can invoke generation for `local`, `openai`, and `anthropic`. ✅
- 2.4 Budget and observability:
  - Token usage + latency metadata are persisted per generation run. ✅
  - Cost estimation is configurable via `.openauthor/provider_pricing.json`. ✅
  - Budget policy enforcement (hard spend/token caps) is deferred to future TODO. 📝
  - Generation run history/failure inspection is available via CLI and desktop runs panel. ✅
  - Normalization quality diagnostics are persisted per run and exposed in run detail views. ✅
  - Generation run quality tiers are filterable in CLI (`generation list --quality ...`) and desktop Runs. ✅
  - Prior runs can be replayed via `generation rerun --id ...` and desktop Runs re-run action. ✅
  - Desktop run detail supports log JSON copy/download for direct audit/debug export. ✅
  - Desktop run replays support override controls (provider/model/temperature/token/context/codex). ✅
  - Desktop run comparison supports selectable baseline-vs-current deltas (plus compare-to-previous shortcut) for instruction, quality, usage, settings, and outcome, with weighting profiles, rule-based recommendation hints, persisted per-project comparison prefs, and JSON/Markdown export. ✅
  - Preferred generation runs can be pinned per scene (CLI + desktop) and surfaced in run/proposal review. ✅
  - Proposal review can jump directly to the preferred proposal linked from a scene’s pinned run. ✅
  - Context lens includes Preferred Pipeline card for scene-level pinned run and linked proposal navigation. ✅

## Phase 2 Closeout Checklist (active)

- [x] Provider adapters and retry/error handling are real (local/openai/anthropic).
- [x] Prompt/context packing and generation artifact logging are reproducible and inspectable.
- [x] Proposal generation is wired through real queue/storage paths.
- [x] Runs observability is fully wired (list/get/filter/rerun/config, quality signals, exports).
- [x] Preferred-run workflow is wired (pin/unpin/list + desktop navigation to preferred run/proposal).
- [x] Desktop runs comparison is wired (baseline selection, profiles, recommendation hints, exports, persisted prefs).
- [x] Regression gates are passing (`make check`, `make test`, `make test-desktop`, `make desktop-build`, `make tauri-check`).
- [ ] Closeout signoff: mark Phase 2 complete with budget policy explicitly deferred to backlog.
- [ ] Backlog hygiene: track budget-policy enforcement as a dedicated Phase 4 follow-on item with acceptance criteria.

Phase 2 exit condition:
- All checklist items are checked except the intentional budget-policy deferral, and that deferral is explicitly accepted.

## No-Mock Guardrails (active)

- Every desktop action must map to a real core command or persisted local computation.
- No placeholder outputs, synthetic “demo” responses, or stubbed provider paths in shipped features.
- New Phase 2 features must include:
  - CLI regression coverage for new command contracts.
  - Unit tests for pure parsing/selection logic.
  - Build gates (`make test-all`, `make desktop-build`, `make tauri-check`) passing.
- Repository check now includes `make audit-no-mocks`.

## Phase 3: Desktop UX (completed)

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

## Phase 3 Execution Checklist (completed)

- 3.1 Workflow speed and navigation
  - [x] Add keyboard shortcuts for high-frequency actions (save scene, run checks, generate proposal, open runs).
  - [x] Add faster cross-tab jump actions from context/review surfaces.
  - [x] Tighten list performance and selection behavior for larger projects.
- 3.2 Editorial triage UX
  - [x] Add clear “preferred pipeline health” badges (missing pin, missing linked proposal, rejected/applied states).
  - [x] Add proposal review filters that prioritize scene + preferred-run linked proposals.
  - [x] Add stronger decision affordances around run comparison recommendations.
- 3.3 Reliability and error UX
  - [x] Standardize user-facing error messages/actions across tabs.
  - [x] Add recovery actions for missing/stale references (deleted run/proposal/scene).
  - [x] Improve loading/busy feedback for multi-command actions.
- 3.4 Packaging and release readiness
  - [x] Define desktop release profile and smoke checklist for macOS first.
  - [x] Validate sidecar/runtime prerequisites and failure messaging on clean machines.
  - [x] Document operator runbook for local setup, diagnostics, and upgrade path.
- 3.5 Test and CI hardening
  - [x] Add desktop state tests for preferred-pipeline and comparison edge cases.
  - [x] Add CLI regression tests for stale pin handling and pin/unpin idempotency.
  - [x] Add CI pipeline to run full gates on push/PR.

Phase 3 exit condition:
- Core authoring workflows are fast and predictable in desktop UX, and release/CI readiness is in place for sustained iteration.
- Status: exit condition satisfied (all checklist items complete).

## Phase 3 Ordered Chunks (execution)

- Chunk 1: Keyboard shortcut acceleration (`save`, `generate`, `run checks`, `open runs`) + tests. ✅
- Chunk 2: Preferred pipeline health status badges and stale-reference recovery UX. ✅
- Chunk 3: Proposal triage prioritization and preferred-linked proposal filters. ✅
- Chunk 4: Busy/loading/error UX standardization across tabs. ✅
- Chunk 5: Desktop release-readiness runbook + macOS smoke checklist. ✅
- Chunk 6: CI pipeline for full gates (`make check/test/test-desktop/desktop-build/tauri-check`). ✅

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

## Future TODO (deferred)

- Budget policy enforcement:
  - Per-run and per-project caps for spend/token budgets.
  - Policy-driven failure behavior and operator controls.

## Definition of done for MVP

- Core flow works locally from a clean clone.
- Basic tests pass.
- Setup and usage are documented.
