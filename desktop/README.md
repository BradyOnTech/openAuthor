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

Voice and the Mobile Inbox are active development surfaces. Advanced run
comparison/export and some workspace hardening UI remain unexposed in V2.
See [capabilities](../docs/capabilities.md) for the distinction between core,
active UI, end-to-end verification, and release readiness.

## Prerequisites

- Node.js 22.6+ and npm (`.nvmrc` selects Node 22)
- Rust toolchain (`cargo`, `rustc`)

Install Rust (if missing):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup default stable
```

Homebrew users can instead run `brew install rustup` followed by
`/opt/homebrew/opt/rustup/bin/rustup toolchain install stable --profile minimal`
on Apple Silicon. The Make targets discover both standard rustup and Homebrew
locations without editing shell startup files.

## Run

```bash
make install-desktop
cd desktop
npm run test
npm run tauri:dev
```

From repo root, operator/release checks:

```bash
make desktop-prereq
make desktop-smoke
```

Runbook:

- [Desktop runbook](../docs/desktop-runbook.md)

## Connect the mobile companion (development)

The browser/PWA and native mobile app are companions for reading, discussing,
capturing ideas, and recording review intent. Manuscript edits stay on desktop.

1. Configure the same HTTPS Supabase origin and public key used by the companion
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). The backend must have the
   project registry, encrypted-sync migrations, and device-bound access-token
   hook configured. No hosting or account is provisioned by the app.
2. In the macOS app, sign in to the shared project library with your companion
   account. "Continue with local books" is always available; explicitly setting
   `VITE_PROJECT_REGISTRY=local` also bypasses cloud login.
3. Open/attach the hosted book and use Mobile Inbox → Connect this desktop.
   Enrollment persists an X25519 identity in the macOS Keychain before making
   remote requests, refreshes the device-bound session, enrolls this desktop for
   the book, and decrypts envelopes for existing project-key versions.
4. For a first book with no keys, provision version 1 (previous version 0), save
   the recovery code privately, and publish a snapshot. Enrolling another device
   still requires a project-key distribution/recovery workflow; this is not yet
   one-step phone pairing. An existing book must not be blindly reprovisioned.
5. Import the companion outbox for desktop review. Import does not apply its
   proposed manuscript changes automatically.

Auth sessions and device identities are isolated by deployment/account in the
Keychain. Password fields are cleared after sign-in attempts. Project keys are
non-extractable in-memory WebCrypto keys; restart unlocks them using the saved
device identity and authenticated server envelopes. Signing out removes the
local auth session but retains the account's device identity for re-enrollment;
it is not device revocation. Legacy pasted access tokens are no longer accepted
and are removed after successful sign-in. Recovery-code imports remain
in-memory. Lost Keychain access must fail closed, not generate replacement keys.

This credential adapter currently supports macOS only. Browser preview still
supports local writing, but cannot sign into the native credential flow.
Neither this local implementation nor its automated tests prove a configured
deployment, signed-app Keychain permissions, or an actual phone voice session.

Native verification: `make tauri-test`. The separate disposable real-Keychain
check is opt-in:

```bash
source scripts/rust_env.sh
cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib credentials::tests::real_keychain_round_trip -- --ignored --exact
```

References: [keyring platform-store features](https://docs.rs/keyring/3.6.3/keyring/),
[Supabase verified JWT claims](https://supabase.com/docs/reference/javascript/auth-getclaims).

## Contract

- UI invokes Tauri commands from `src-tauri/src/lib.rs`.
- Release builds invoke a checksum-pinned Python runtime embedded in the application resources; development builds may fall back to an explicit or local Python interpreter.
- Tauri invokes the core with `python3 -m openauthor ...` and supervises the long-lived Assistant sidecar.
- `project_root` is passed by the UI and used as working directory.

## AI provider credentials (for desktop generation)

- OpenAI: set `OPENAI_API_KEY`
- Anthropic: set `ANTHROPIC_API_KEY`
