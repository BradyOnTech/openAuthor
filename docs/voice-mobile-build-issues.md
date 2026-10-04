# Voice and Mobile Build Issues

This file records unresolved implementation questions or blockers discovered
while executing the [Voice and Mobile Build Plan](voice-mobile-build-plan.md).

## VM-001 — BuildWealth code reuse permission is not documented

Status: Open\
Discovered: 2026-08-30\
Blocks: Direct copying of BuildWealth implementation code\
Does not block: Independent openAuthor-native implementation based on general
architectural patterns

Evidence:

- The local BuildWealth checkout is at
  `~/Documents/code/brady/BuildWealth`.
- No `LICENSE*`, `COPYING*`, or `NOTICE*` file exists within the first three
  repository levels.
- Its configured origin is `https://github.com/BradyOnTech/BuildWealth.git`.

Required resolution:

- Confirm that the BuildWealth owner authorizes reuse in openAuthor and add an
  appropriate license/notice, or
- Keep all implementation independent and classify BuildWealth as
  inspiration-only.

Current approach:

- Do not copy BuildWealth source code.
- Reimplement approved concepts behind openAuthor-native interfaces and tests.

## VM-002 — Mobile context execution model

Status: Resolved\
Discovered: 2026-08-30\
Resolution: The privacy-first local TypeScript adapter over an encrypted
snapshot projection is selected and implemented. Hosted infrastructure stores
only ciphertext and routing metadata; selected context is disclosed to OpenAI
only during a user-started Realtime session.

Options are documented in
[Mobile execution constraint](voice-mobile-build-plan.md#mobile-execution-constraint):

- Privacy-first local TypeScript adapter over an encrypted snapshot projection
- Runtime-parity hosted Python worker with transient in-memory decryption

Any future hosted Python runtime with transient plaintext access requires a new
privacy/security decision and is outside this release.

## VM-003 — Native Rust verification is unavailable on this host

Status: Open\
Discovered: 2026-08-30\
Blocks: Claiming the Tauri native bridge change is verified\
Does not block: Python, TypeScript, Vitest, or browser-level voice work

Evidence:

- `cargo test duplicate_pending_sidecar_request_ids_are_rejected` fails before
  compilation because `cargo` is not installed or available on `PATH`.
- The Rust change rejects duplicate pending sidecar request IDs instead of
  replacing the first response channel, and includes a focused unit test.

Required resolution:

- Run the focused Rust test and the full native test suite in the bundled
  local desktop build environment with the pinned Rust toolchain.

## VM-004 — Live Realtime audio and signed-app permissions are not verified

Status: Open\
Discovered: 2026-08-30\
Blocks: Desktop voice beta readiness\
Does not block: Fake-transport tests, session policy, Context Packs, or UI work

Evidence:

- The WebRTC transport and unified `/v1/realtime/calls` negotiation are covered
  with fakes; no permanent OpenAI credential was used during this build.
- `Info.plist` and hardened-runtime audio-input entitlements are configured, but
  no signed/notarized app was built on this host.

Required resolution:

- Test with an authorized OpenAI API project, verify current model access, and
  run microphone, speaker routing, permission denial, barge-in, session expiry,
  and reconnect scenarios in signed macOS artifacts.
- Repeat the platform gate for Windows before enabling voice there.

## VM-005 — Hosted billing and limits are not selected

Status: Open\
Discovered: 2026-08-30\
Blocks: Production commercial rollout of the mobile Session Gateway\
Does not block: Deployment to a restricted internal/private beta

Open decisions:

- Whether hosted mobile voice is subscription-funded, metered, user-funded, or
  limited to a trial allowance.
- Per-user concurrency, duration, and spend limits for the initial rollout.

Current approach:

- Supabase Auth, workspace membership, the session-bound `device_id` claim, and
  the RLS/RPC layer are now the implemented identity authority.
- The gateway fails closed without verified project/device authorization and
  clamps the Realtime policy server-side. Distributed quota and billing policy
  remain open.

## VM-006 — Realtime policy needs post-issuance enforcement

Status: Open\
Discovered: 2026-08-30\
Blocks: Claiming that the hosted gateway continuously enforces mobile Realtime
session policy\
Does not block: Creation-time policy clamping, fake-upstream gateway tests, or
device-local rejection of unavailable and write-like tools

Evidence:

- The gateway can clamp model, voice, instructions, and tools when it creates a
  call, but the WebRTC data channel can carry later Realtime control events.
- A hostile or modified client must never gain manuscript mutation authority;
  local Tool Registry enforcement already remains the final project-action
  boundary.

Required resolution:

- Choose and test a server sideband policy monitor, or define a narrower
  server-observable client-event contract that prevents or terminates policy
  widening after issuance.
- Add integration tests for later `session.update` events, tool allowlists,
  revocation, maximum duration, and administrative termination before mobile
  production rollout.

## VM-007 — Hosted encrypted-sync deployment is not exercised end to end

Status: Open\
Discovered: 2026-08-30\
Blocks: Production/mobile beta sync readiness\
Does not block: Local crypto, contract, RLS, transport, and outbox tests

Evidence:

- The migration and adversarial SQL suite pass on fresh PostgreSQL 17.11.
- Desktop/mobile transport and crypto seams are covered with deterministic
  fakes, including composite outbox pagination and per-row malformed-ciphertext
  isolation, but this checkout has no target Supabase project credentials.

Required resolution:

- Enable `mobile_custom_access_token_hook` in the target Supabase project.
- Apply and verify the guarded private-bucket/Storage-policy migration in a
  real Supabase stack; the plain PostgreSQL harness intentionally has no
  `storage` schema.
- Run two-device enroll, rotate, publish, download, revoke, recovery, outbox,
  replay, conflict, and deletion drills against the deployed stack.
- Deploy a trusted lifecycle worker that calls the owner-only cleanup-manifest
  seam, deletes and verifies every encrypted Storage object, then deletes or
  transfers project/account metadata. SQL intentionally does not delete
  `storage.objects` directly.

## VM-008 — Native mobile modules need signed physical-device validation

Status: Open\
Discovered: 2026-08-30\
Blocks: TestFlight/Play internal-track release\
Does not block: Type checking, unit tests, Expo Doctor, or Metro export

Evidence:

- Expo Doctor passes after explicitly acknowledging that React Native Directory
  does not yet mark `react-native-webrtc` or `react-native-libsodium` as tested
  on the New Architecture.
- The iOS production bundle exports successfully; no signed native app or real
  audio route was exercised in this build.
- `npm audit --omit=dev` reports 11 moderate issues through Expo's Xcode build
  tooling and the legacy `uuid` dependency, with no compatible non-breaking
  remediation. There are no high or critical findings.

Required resolution:

- Complete the signed iOS/Android build and audio/device matrix in
  `mobile/release-checklist.md`.
- Inspect the final permission manifests, verify camera/background audio remain
  absent, and rerun binary/dependency scans before release.
- Recheck the Expo dependency tree on each SDK upgrade; do not apply the audit
  tool's incompatible forced downgrade.

## VM-009 — Mobile project-key approval UX is basic

Status: Open\
Discovered: 2026-08-30\
Blocks: Broad self-service production rollout\
Does not block: Explicit device enrollment, independently sealed envelopes,
printable recovery, or a managed private beta

The crypto and RPC lifecycle is implemented, including session rebinding and
atomic project-key envelopes, but a polished trusted-device approval ceremony,
recovery confirmation, and lost-device operator workflow still require product
UX and hosted end-to-end drills. Device-key rotation is deliberately
owner-only until it can atomically reseal every accessible project key.

## VM-010 — Desktop hosted-sync setup is an engineering seam, not finished UX

Status: Open\
Discovered: 2026-08-30\
Blocks: Self-service mobile-sync onboarding\
Does not block: Local projects, desktop/mobile feature testing with injected
hosted credentials, or the encrypted sync protocol

The desktop now has concrete hosted transport, atomic key provisioning,
snapshot publication, paginated multi-version outbox import, and Mobile panel
controls for provision, in-memory recovery unlock, publish, and import. The
current Supabase-backed desktop registry still uses its existing developer
access-token gate; it does not yet provide normal Auth refresh, first-time
desktop device registration, or an OS-backed persistent desktop device key.

Required resolution:

- Replace the developer token gate with normal Supabase sign-in/session refresh.
- Persist the desktop device private key in an OS-backed secret store, never
  `localStorage`, and bind it to the refreshed session claim.
- Replace the current recovery-display/manual controls with a polished
  confirmation, trusted-device approval, rotation, revoke, and sync-status UX.
