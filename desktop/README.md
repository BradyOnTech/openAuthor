# openAuthor Desktop

Desktop shell for openAuthor using Tauri + React.

Current UI slice:

- Binder (scene list + create scene)
- Editor (load/edit/save scene metadata + body)
- Outliner (filter/search scene cards, open in editor)
- Proposal Review (proposal create/list/apply/reject)
- Proposal Generate (provider-backed proposal generation from desktop)
- Generation Runs (history/errors with run detail inspection)
  - Includes provider runtime config (credentials present/missing, retry settings)
- Context Lens (scene-linked proposal/codex/continuity context)
- Codex Panel (entity create/list/edit)
- Continuity Checks (run/list/jump to scene)

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

## Contract

- UI invokes Tauri commands from `src-tauri/src/lib.rs`.
- Tauri invokes the Python core with:
  - `python3 -m openauthor ...`
- `project_root` is passed by the UI and used as working directory.

## AI provider credentials (for desktop generation)

- OpenAI: set `OPENAI_API_KEY`
- Anthropic: set `ANTHROPIC_API_KEY`
