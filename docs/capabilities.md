# Capability status

This page explains how openAuthor reports product status. The machine-readable source of truth is [`capabilities.json`](capabilities.json); `make capability-check` validates its schema, evidence paths, and visible-product claims.

## Status model

- **Core** means the Python engine or a deterministic desktop helper exists and is tested in isolation.
- **Active UI** means the workflow is reachable in the current V2 desktop shell. `partial` means the visible workflow deliberately exposes only a narrower slice.
- **End-to-end verified** means an automated test has crossed every author-visible step in the rendered desktop application. A core or native-bridge test alone is not sufficient.
- **Release-ready** additionally requires installation, recovery, performance, documentation, and clean-machine release gates.

These states are intentionally independent. Core code is not treated as a shipped feature merely because it exists in the repository.

## Current product truth

As of 2026-08-14, the active V2 desktop includes project creation/opening, a first-safe-revision guide, staged Markdown/TXT/DOCX/Scrivener manuscript import, Markdown/DOCX export with loss reports, startup health with guided safe repair, atomic scene save with an unsaved-draft recovery journal, scene editing, a portable Plan workspace with story time, labels, move-impact previews, and arc overview, atomic single- and coordinated multi-scene AI Change Sets, structured temporal Story Memory with correction and bulk review, character arcs, evidence-backed Canon diagnostics, full-project search, reusable custom Editorial Passes, author-controlled Style Profiles, creative alternative comparison, Book/Scene/Chapter/Character/Storyline-scoped Assistant chat whose results promote to durable artifacts, ChatGPT subscription sign-in through a bundled Codex app-server, semantic Storyline experiments, Revision retrospectives, a private on-device product dashboard, budget controls, and generation history. Project onboarding, scene editing, planning, Change Set apply-and-undo, Story Memory correction and bulk acceptance, Canon Fact creation, coordinated multi-scene generation, and the Storyline create/compare/integrate path have rendered cross-boundary workflow coverage; the other visible capabilities remain below that bar.

Advanced run comparison/export and Voice helpers remain hidden. The deeper workspace audit and performance diagnostics remain CLI-only; blocking startup health is visible in the workbench. A checksum-pinned embedded Python runtime builds into a real macOS `.app` and passes an isolated packaged-core smoke test. The Editorial Pass corpus now measures all seven built-ins across seven genres with zero canon regressions, and the Canon corpus includes Character Arc diagnostics. None of the visible workflows is yet marked release-ready because Developer ID signing/notarization, both-architecture clean-machine validation, broader design-partner data, and full packaged-app automation remain open.

The rendered React contract verifies first launch, project creation, scene creation/edit/save, project brief and hierarchy creation, scene beats and planning metadata, one-action Change Set generation, comment-driven hunk revision, hunk exclusion/re-inclusion, selected application, one-click undo, coordinated multi-scene generation, Story Memory correction and bulk acceptance, Storyline comparison/integration, and evidence-backed Canon Fact creation. The native Rust bridge independently verifies the real Tauri-to-Python command path for the golden revision loop, including restoration of the prior scene and a new undo Revision. Together they satisfy the current source-level cross-boundary gate, though packaged GUI automation is still required for release.

## Updating status

1. Change implementation and tests.
2. Update `docs/capabilities.json` with evidence from the active path.
3. Run `make capability-check` and the relevant workflow gate.
4. Mark `end_to_end=verified` only when the rendered desktop workflow is automated.
5. Mark `release=ready` only when that capability's release conditions are also satisfied.

The forward-looking sequence and exit criteria live in [`product-development-plan.md`](product-development-plan.md).
