# Product Brief

## Source

- Shared conversation: `(private planning conversation)`
- Conversation title: `AI-Assisted Fiction Authoring`

## Problem statement

Build a superior alternative to Sudowrite/NovelCrafter for a power user who wants:

- local-first control of manuscript and IP
- Git-style branching/merging for narrative experimentation
- structured continuity via a codex
- AI assistance that is contextual, inspectable, and reversible

## Product goals

- Treat each book as a versioned project, not a single long document.
- Keep storage durable and human-readable (scene-based markdown).
- Make AI output proposal-based (review/apply/reject), never silent auto-edits.
- Support pluggable LLM providers and future voice workflows.

## MVP scope (first executable milestone)

- Scene editor data model:
  - Scene-per-file markdown in `manuscript/scenes/`
  - Front matter metadata (title, POV, status, summary, timestamps)
- Codex data model:
  - Local SQLite runtime storage for entities
  - Deterministic `codex/codex.json` export for git snapshot/version history
  - Basic entity types (character/location/lore/item/faction/event)
- Proposal workflow:
  - Proposal queue with status lifecycle (pending/applied/rejected)
  - Association to scene ids
- Snapshot workflow:
  - Git-backed snapshots with friendly commands

## Deferred capabilities (post-MVP)

- Rich desktop UI (Tauri + modern editor UX)
- RAG + embeddings index tied to git commit state
- Multi-agent orchestration and retrieval trace UI
- Voice dictation and realtime conversation controls
- Semantic merge assistant and conflict resolution UX

## Architecture direction

- Local-first core with clean adapter boundaries:
  - Manuscript store (markdown files)
  - Codex store (SQLite runtime + JSON snapshot artifact, swappable later)
  - AI provider layer (`local`, `openai`, `anthropic`) with proposal-generation orchestration
  - Proposal engine (human-in-the-loop)
- Keep AI orchestration independent from storage primitives.
