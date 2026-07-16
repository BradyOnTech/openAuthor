# Product Brief

## North star

> An AI assistant for novel writing that treats writing a novel like software engineering, allowing continuous iteration and experimentation with revision history and creative suggestions.

The author-facing promise is a private story studio that remembers canon, proposes reviewable changes, and lets an author explore creative directions without losing the manuscript they trust.

The canonical forward-looking roadmap is `docs/product-development-plan.md`. `docs/plan.md` preserves the engineering delivery history and points to that plan for future phases.

## Source

- Shared conversation: `(private planning conversation)`
- Conversation title: `AI-Assisted Fiction Authoring`

## Problem statement

Build a differentiated alternative to Sudowrite/NovelCrafter for a serious fiction author who wants:

- local-first control of manuscript and IP
- Author-facing Revisions for every safe change, plus Git-backed branching/merging adapters for narrative experimentation
- structured continuity via a codex
- AI assistance that is contextual, inspectable, and reversible
- evidence-backed Story Memory across scenes and books
- granular review of AI changes before they enter the manuscript

## Product goals

- Treat each book as a versioned project, not a single long document.
- Keep storage durable and human-readable (scene-based markdown).
- Make AI output proposal-based (review/apply/reject), never silent auto-edits.
- Evolve proposals into concrete Change Sets with inline diffs and selective acceptance.
- Translate Git primitives into author-facing Revisions and Storylines.
- Support pluggable LLM providers and future voice workflows.

## Product wedge

openAuthor will first win at safe revision of complex fiction, not generic blank-page generation. It should help an author understand an existing manuscript, change it without breaking canon or voice, and experiment with alternate story directions safely.

Team collaboration, broad voice workflows, multi-agent orchestration, and mobile editing remain expansion paths after the single-author golden loop is proven.

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
- RAG + embeddings index tied to local Revision and source-digest state
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
