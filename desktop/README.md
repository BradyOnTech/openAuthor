# openAuthor Desktop

Desktop shell for openAuthor using Tauri + React.

Current UI slice:

- Binder (scene list + create scene)
- Editor (load/edit/save scene metadata + body)
- Crash-recovery journal for unsaved scene title/body changes
- New-project manuscript import with structure preview (Markdown, TXT, DOCX, or scene folder)
- Markdown/DOCX export with an adjacent loss report
- Outliner (filter/search scene cards, open in editor)
- Proposal Review (proposal create/list/apply/reject)
- Proposal Generate (provider-backed proposal generation from desktop)
- Proposal Generate now includes retrieval mode controls (`off/auto/required`, limit/min-score, require-fresh), with desktop default set to `auto`.
- Generation Runs (basic read-only history)
- Guided Merge (branch create/switch, diff/preflight, merge apply)
- Assistant Chat (project context, citations, and proposal promotion)
- Inspector (selected-scene metadata)
- Codex Panel (entity create/list/edit)
- Continuity Checks (run/list/jump to scene)
- Generation Budget controls
- Startup health with guided safe repair
- First-safe-revision onboarding guide

Advanced run comparison/export, Voice helpers, and workspace hardening UI from the earlier shell are intentionally not exposed in V2. See `docs/capabilities.md` for the distinction between core, active UI, end-to-end verification, and release readiness.

## Prerequisites

- Node.js + npm
- Rust toolchain (`cargo`, `rustc`)

Install Rust (if missing):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup default stable
```

## Run

```bash
cd desktop
npm install
npm run test
npm run tauri:dev
```

From repo root, operator/release checks:

```bash
make desktop-prereq
make desktop-smoke
```

Runbook:

- `docs/desktop-runbook.md`

## Contract

- UI invokes Tauri commands from `src-tauri/src/lib.rs`.
- Release builds invoke a checksum-pinned Python runtime embedded in the application resources; development builds may fall back to an explicit or local Python interpreter.
- Tauri invokes the core with `python3 -m openauthor ...` and supervises the long-lived Assistant sidecar.
- `project_root` is passed by the UI and used as working directory.

## AI provider credentials (for desktop generation)

- OpenAI: set `OPENAI_API_KEY`
- Anthropic: set `ANTHROPIC_API_KEY`
