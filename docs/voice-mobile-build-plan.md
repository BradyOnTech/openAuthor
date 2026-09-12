# Voice and Mobile Build Plan

Status: Active mobile-companion delivery; browser/PWA path added, deployment and live-device verification remain

Owners: openAuthor product and engineering

Last updated: 2026-09-07

Related plans: [Chat Redesign](chat-redesign.md), [Product Development Plan](product-development-plan.md)

Research input: [BuildWealth Context Management](research/buildwealth-context-management.md)

## Decision summary

The author reaffirmed that a mobile experience with voice is required now and
agreed that mobile is a companion, not a full manuscript editor. The PWA and
native app share the existing React Native UI and snapshot/outbox/tool rules.
The browser path removes the native signing/store prerequisite for first access;
it does not remove backend configuration, HTTPS, approval policy, or device QA.

### 2026-09-07 browser delivery implementation

- Expo web export, install manifest, home-screen icon, and versioned offline
  application-shell cache. The service worker does not cache auth, API traffic,
  manuscript snapshots, or voice sessions.
- Browser WebRTC playback and shared authenticated, cancellable gateway
  negotiation. No permanent OpenAI key is included in either mobile bundle.
- Browser-specific encrypted IndexedDB adapters for auth, enrollment, project
  snapshots, and immutable pending work. The non-exportable wrapping key is
  browser-origin scoped; this is explicitly not equivalent to a native keychain
  and does not defend against malicious same-origin scripts.
- Explicit `web` device enrollment via an additive database migration. Native
  platform identities and authorization remain unchanged.
- Initial voice context includes the selected scene and snapshot revision before
  microphone input is enabled. Voice remains read/propose-only.
- Cancel while connecting, stop on leaving the voice screen/backgrounding,
  late-microphone cleanup, connection timeout, data-channel readiness and
  disconnect handling, and output-buffer clearing on interruption.
- Browser walkthrough covers sample reading, selected-scene Assistant scope,
  capture/review, sign-out, and offline app-shell reopening. This does not prove
  hosted sync, a real OpenAI conversation, physical-phone audio, or offline
  access after hosted authentication expires.

No configured backend or OpenAI key is present in the current environment.
Preview mode is labeled, uses an original sample, asks for no login credentials,
and disables voice. It is not the completed mobile-voice deliverable. The next
delivery gate is approved backend configuration, real project publication and
enrollment, then a phone-to-OpenAI-to-desktop-review walkthrough.

Implementation references: [Expo web](https://docs.expo.dev/workflow/web/),
[Expo PWA](https://docs.expo.dev/guides/progressive-web-apps/), and
[OpenAI WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc).

### 2026-09-07 desktop enrollment implementation

The native macOS desktop now has secure companion sign-in and retryable device
enrollment. A Keychain-backed, deployment/account-scoped identity is saved before
remote registration. Connecting the active hosted book verifies and refreshes
the device session, enrolls the project, and restores non-extractable project
keys from authenticated sealed envelopes. Mobile Inbox exposes connection,
manual encrypted publication/import, and recovery controls. Local writing is
available without a cloud account; no raw access-token paste is required.

The codebase-design skill guided one enrollment interface that owns persistence,
registration, identity checks and envelope decryption, with injected account and
secure-store adapters. Callers and tests use that same interface. Heavy cloud
and cryptographic dependencies load only for the relevant workflow.

Local evidence: 164 desktop tests, production build, 8 native tests, a separate
real Keychain round trip, and browser/real-Python authoring walkthroughs pass.
The Rust toolchain is now installed; older checkpoint notes about missing Cargo
below are historical. The Keychain test does not prove signed-app access or
hosted Supabase enrollment. Phone pairing/recovery, durable mobile registration,
hosted deployment, real phone voice, and complete mobile-to-desktop review remain
required. Sign-out clears the local auth session but retains device identity;
device revocation is a separate action not yet exposed on desktop.

See [desktop setup and privacy behavior](../desktop/README.md#connect-the-mobile-companion-development)
and [production readiness](production-readiness.md) for current evidence and gaps.

### 2026-09-07 phone enrollment and recovery implementation

Phone/browser enrollment now persists one canonical private identity before any
registration request. Lost responses, restart, concurrent browser tabs, and
metadata-write failures reuse the same identity. Corrupt/missing keys fail
closed, and signing in with a different account no longer deletes existing
encrypted work without an explicit removal action.

A new phone can enter the selected book's recovery key before opening its first
snapshot. The key is verified locally against the authenticated encrypted
manifest before it is stored. Failed opening offers retry and back navigation,
and recovery errors do not overwrite a previously saved key.

Verification now includes 55 mobile tests and a real browser/desktop/Python
encrypted round trip with locally simulated hosting. It covers lost enrollment
response, wrong-key rejection, restored book access after restart, encrypted
capture upload, and durable desktop inbox import without manuscript mutation.
The hosted test does not exercise real RLS or OpenAI. Physical-phone voice and
live deployment remain outstanding; manual recovery is not the final trusted
pairing/key-distribution experience. See `production-readiness.md` for follow-ups.

### 2026-09-07 downloaded-library implementation

The companion now separates local downloaded access from hosted authorization.
Successful verified enrollment creates a device/account/deployment-bound local
record. Successfully opened snapshots get encrypted per-book library entries.
An explicit downloaded-library mode persists across restarts and can also be
selected from the connecting/sign-in screens. It reads snapshots, previews the
encrypted review queue and captures ideas without initializing the auth SDK.

Reconnect is explicit and refreshes/verifies hosted credentials before online
library access. Voice, upload and key recovery are unavailable in downloaded
mode. Sign-out locks local access durably and removes stored auth records while
retaining encrypted work; a new online same-account sign-in can unlock it.
Downloaded-mode sign-out does not claim server revocation, and offline copies
cannot be remotely erased while disconnected. The local record never becomes
a server credential. Capture/voice outbox envelopes now keep the revision of the
snapshot actually used as context rather than substituting a later cache revision.

The browser/desktop/Python test now covers expired auth, offline cold restarts,
read/capture/queue reopening with no hosted requests, verified reconnect, offline
sign-out, same-account recovery of queued captures, and import without changing
prose. The service worker is active in this test; HTTP hosting remains simulated.
Physical-device voice, deployment, native storage/revocation hardening and broad
novel-writing quality remain outstanding. The latest evidence is recorded in
`production-readiness.md`.

### Shared architecture

openAuthor adds conversational voice through the OpenAI Realtime API over
WebRTC. Desktop text and voice share one Python Assistant Runtime and one
Context Pack module. Mobile uses the selected privacy-first design: a narrow
TypeScript adapter over an encrypted local snapshot, with shared versioned
contracts and policy fixtures. No channel owns independent approval rules.

The work will ship in this order:

1. Extract the current chat context, history, provenance, and tool rules behind
   stable Assistant interfaces.
2. Add desktop voice using WebRTC, with the local Python sidecar controlling
   project context and tool execution.
3. Add a hosted Session Gateway that authenticates users and creates
   short-lived Realtime sessions without exposing permanent OpenAI credentials.
4. Add opt-in encrypted project snapshots and an encrypted mobile outbox.
5. Build a React Native mobile companion centered on voice, text chat, capture,
   reading, and Change Set review.
6. Consider full mobile manuscript editing only after the companion demonstrates
   retained use.

BuildWealth is a reference implementation, not a runtime dependency. Because
the local checkout has no discoverable license or reuse notice, openAuthor does
not copy its source. Approved architectural ideas are independently
reimplemented behind openAuthor-native interfaces and tests.

## Implementation checkpoint — 2026-08-30

The core desktop, hosted, encrypted-sync, and mobile companion slices are now
implemented. This is not a production-release claim: deployment configuration,
live OpenAI/Supabase integration, signed native binaries, store review, and the
physical-device audio matrix remain release gates.

Completed and verified locally:

- Shared Assistant modules for deterministic history, bounded opaque
  references, global input budgeting, Context Packs, channel-aware tools,
  durable turns, keyed cross-process thread locks, and replay-safe approved
  tool actions.
- Text-chat compatibility through the shared Context Pack and Turn journal.
- Content-addressed Context Pack manifests linked from durable turns.
- Privacy-safe generation logs: metadata/digests by default, explicit local
  audit opt-in for full content, and runtime logs excluded from Git.
- Semantic `assistant.event` dual emission plus a TypeScript reducer that
  detects duplicates, gaps, conflicts, and multiple terminal states.
- Desktop Realtime technical slice: WebRTC transport, current OpenAI event
  translation, semantic VAD session policy, microphone packaging declarations,
  start/mute/interrupt/end controls, local tool handling, and final transcript
  recording.
- Unified server-mediated SDP negotiation against `/v1/realtime/calls`; the
  permanent OpenAI key remains in the trusted Python process.
- Atomic regeneration with durable supersession lineage, send/truncate
  serialization, timeout recovery through `assistant.turn.get`, and duplicate
  tool-approval protection.
- Versioned shared contracts and fiction-domain fixtures for context, turns, tools,
  voice, enrollment, project keys, encrypted snapshots, and immutable outbox.
- Production-shaped Session Gateway with Supabase JWKS verification,
  session-bound project/device authorization, server-owned Realtime policy,
  request/rate/time/size guards, and content-free errors and auditing.
- Supabase RLS metadata and RPCs for devices, project enrollment, key rotation,
  sealed key envelopes, encrypted snapshots, acknowledgements, and encrypted
  outbox, plus a session-bound Custom Access Token Hook.
- Deterministic snapshots, AES-256-GCM publication/download/integrity checks,
  X25519 sealed project-key distribution, encrypted local cache, printable
  recovery keys, revocation cleanup, and idempotent desktop import.
- Expo/React Native companion for sign-in, project selection, offline scene
  reading/search, cited voice and text chat, capture/dictation, encrypted review
  outbox, privacy/settings, recovery, and local device-data deletion.
- Desktop hosted sync coordinator and Mobile Inbox controls for in-memory key
  provision/unlock, snapshot publication, paginated multi-version outbox import,
  and read-only review. First-time desktop device registration remains a native
  onboarding gate and fails closed in the panel.
- Hosted outbox paging uses a stable `(received_at, operation_id)` cursor, and
  malformed ciphertext rows are rejected individually without starving valid
  operations later in the same page.

Current automated evidence:

- Python: 166 tests pass.
- Desktop: TypeScript/Vite production build passes; 134 tests pass. Heavy
  libsodium and contract-validation code is lazy-loaded outside editor startup.
- Shared contracts: type-check plus 18 tests pass.
- Session Gateway: type-check, production build, emitted-process health/shutdown
  smoke, and 28 tests pass.
- Mobile: type-check plus 33 tests pass; Expo Doctor passes 21/21 checks; an iOS
  Metro production export succeeds (866 modules).
- Supabase: the migration and adversarial RLS smoke suite pass on fresh local
  PostgreSQL 17.11, including Realtime authorization privileges.
- Rust duplicate-request protection is implemented, but the current host lacks
  `cargo`; native verification remains recorded in the issue log.

| Area | Local status | Still required for production |
| --- | --- | --- |
| Shared Assistant Runtime | Implemented and covered | Live-provider quality/cost evaluation and longer-session tuning |
| Desktop Realtime voice | Implemented with fake transport and production build | Live Realtime, signed-app audio routes, expiry/reconnect soak, Windows validation |
| Hosted Session Gateway | Deployable process/container, auth/RPC adapters, and guards implemented | Target deployment, distributed limits, billing authority, key rotation operations, post-issuance sideband enforcement |
| Encrypted sync | Contracts, 64 MiB bounds, RLS, Storage policy migration, crypto, transport, recovery, session rebinding, revocation, and paginated multi-key outbox implemented | Desktop device onboarding, target Supabase reset, hosted end-to-end test, lifecycle deletion worker |
| Mobile application | Companion UI, offline adapter, sync, and voice stack implemented | Signed iOS/Android builds, native-module/device/audio/accessibility/store testing |

Still required before a desktop voice beta:

- A real OpenAI Realtime session and microphone/audio-route soak test on signed
  macOS builds.
- Session expiry/reconnect, usage accounting, feature flagging, and a richer
  inspectable Context Pack/citation view.
- Windows permission and packaging verification.

See [Voice and Mobile Build Issues](voice-mobile-build-issues.md) for the
remaining external, authority, and release gates.

## Why this plan exists

The existing desktop chat is a streamed request/response flow. A Realtime voice
conversation is a long-lived session with overlapping input, output,
interruptions, function calls, partial transcripts, and reconnects. Treating
voice as speech-to-text followed by `chat.send` would create duplicate model
turns, higher latency, and separate context behavior.

Mobile adds a second constraint: openAuthor's manuscript and intelligence are
currently local files managed by a bundled Python runtime. A mobile microphone
can connect to Realtime easily, but a useful mobile assistant also needs a safe,
current, offline-capable view of the project. Mobile voice therefore depends on
project snapshot and sync work; desktop voice does not.

This plan intentionally preserves openAuthor's product rules:

- Local projects remain usable without an account or network.
- Cloud sync and hosted voice are opt-in.
- Model-visible context remains inspectable and source-linked.
- Read tools may run automatically; manuscript writes require author review.
- Voice never bypasses Change Sets, Revisions, Story Memory review, or Storyline
  integration.
- Raw microphone audio is not persisted by openAuthor by default.

## Roadmap gate

The original product plan placed rich voice and mobile after the golden loop and
single-author retention. That sequencing is superseded by the explicit mobile
companion requirement and the updated product plan.

The user has activated this roadmap and selected the privacy-first mobile
model. Desktop voice can still ship independently behind an Advanced/private
beta flag. Hosted operating cost, quotas, and rollout sequencing remain product
gates rather than implementation blockers.

## Goals

### Desktop voice milestone

An author can open an existing Assistant thread, enter a voice conversation,
discuss the active scene or book, interrupt naturally, inspect the transcript
and cited sources, and ask the assistant to prepare a reviewable Change Set.

### Mobile companion milestone

An authenticated author can download an encrypted project snapshot, use voice
or text against that local snapshot, capture notes while offline, and send
notes or prepared changes back to the desktop review queue without directly
mutating manuscript prose.

### Shared-context milestone

Given the same project revision, scope, explicit references, user intent, and
budget policy, text chat and desktop voice produce the same Context Pack. The
privacy-first mobile adapter supports a deliberately smaller source/tool set and
must pass shared policy fixtures for authority, explicit-reference precedence,
budgeting, provenance, freshness, and approval. The exact serialized provider
input may vary by channel.

## Non-goals for the first release

- Background or always-listening mobile audio
- Telephone/SIP access
- Full mobile manuscript editing
- Multi-user live co-editing
- Storing or replaying raw conversation audio
- Sending an entire novel into every Realtime session
- Allowing voice tools to apply manuscript changes directly
- Replacing the Python project engine with Rust or TypeScript
- Reusing ChatGPT/Codex subscription authentication for Realtime API usage
- Making BuildWealth a package dependency

## Baseline at planning start

The plan began from the working behavior below rather than replacing it
wholesale. The implementation checkpoint above records which of these original
gaps are now closed in the local technical slice.

### Context and history already present

- `openauthor/chat.py::_normalize_context_profile` defines Assistant scope,
  explicit/current-scene inclusion, nearby-scene radius, Story Memory/Codex
  policy, retrieval policy, history budget, and tool approval defaults.
- `openauthor/chat.py::_resolve_context` selects explicit and nearby scenes,
  auto-matches named Codex entities, runs retrieval, attaches citations and
  freshness state, and creates a bounded Book-scope scene index.
- `openauthor/chat.py::_build_provider_history` creates a recent contiguous
  token-windowed history and normalizes roles for provider compatibility.
- `openauthor/retrieval.py` builds a local, content-digested lexical index over
  scenes and Codex data, detects staleness, and returns ranked cited chunks.
- Every chat message persists `context_used`, tool calls, and usage. Assistant
  turns also carry a revision/VCS anchor.

### Tool and review behavior already present

- Native provider tools are defined in `CHAT_TOOL_SPECS`.
- Read tools can run automatically and feed their outputs into the same turn.
- Write and risky tools remain pending until author approval.
- Approved changes retain before/after revision evidence.

### Desktop bridge already present

- `openauthor/server.py` provides a persistent, ordered JSONL bridge.
- `chat.send`, `chat.interrupt`, `chat.threads`, `chat.messages`, and
  `chat.truncate` are already long-lived sidecar methods.
- `desktop/src/components/secondary/ChatPanel.tsx` already owns active thread,
  scope, mentions, transcript rendering, streaming, interrupt, citations, and
  pending-tool review.

### Gaps this plan closes

- Context packing is private logic inside the large `chat.py` module.
- Context has no versioned first-class schema shared with other channels.
- Prompt context and provenance context are separate ad hoc dictionaries.
- Retrieval and history budgets are independent rather than coordinated under
  one total input budget.
- Realtime session state and events do not exist.
- The sidecar emits text deltas rather than a semantic turn/event protocol and
  serializes sends behind one process-wide lock.
- Full prompts and manuscript context are duplicated into generation logs,
  which is unsuitable as the default persistence policy for hosted/mobile use.
- Desktop packaging lacks production microphone permission configuration.
- Supabase stores workspace/project registry metadata, not manuscript content,
  encrypted snapshots, device keys, or outbox operations.
- No iOS or Android application exists.

## BuildWealth findings and adoption policy

The detailed source audit lives in
[`docs/research/buildwealth-context-management.md`](research/buildwealth-context-management.md).
It found that BuildWealth's strongest pattern is its staged separation of
trusted-reference resolution, canonical context assembly, bounded prompt-brief
compilation, deterministic tool selection, durable turn execution, and an
auditable context/tool trace. openAuthor should adopt that shape without
adopting the finance ontology.

Use these categories. Because no BuildWealth license or reuse notice was found,
the matrix contains no source-copying category:

| Category | Meaning | Required action |
| --- | --- | --- |
| Adapt | Useful algorithm or behavior with different types, persistence, or trust rules | Independently reimplement behind openAuthor's interfaces and add fiction-domain fixtures |
| Inspire | Architectural idea whose original implementation is tightly coupled to BuildWealth | Record the idea; do not copy code |
| Reject | Conflicts with local-first, provenance, deterministic budgets, or review-first writes | Document why and leave it behind |

Completed adoption matrix:

| BuildWealth pattern | Decision | openAuthor use |
| --- | --- | --- |
| `ExpiringCache` TTL/max-entry/metrics behavior | Inspire | Reimplement only if profiling shows a cache is needed; key by project revision/source digest |
| Exact `{type,id}` reference resolution | Adapt | Independently implement strict validation, deduplication, project authorization, bounded evidence, sanitized errors, and value-free traces through authoring adapters |
| Tool metadata, provider capabilities, deterministic selection, startup catalog validation | Adapt | Independently implement Assistant channel, scope, and `read`/`propose`/`apply` policy |
| Retrieval item packing, truncation, citations, and budget trace | Adapt | Independently implement one global model-input token allocator rather than BuildWealth's independent character caps |
| Durable client turn ID, idempotent retry, explicit status transitions | Adapt | Reimplement on openAuthor's append/atomic storage; do not copy BuildWealth's whole-file conversation store |
| Semantic stream events for stage, turn, tool, pending action, delta, result, and error | Adapt | Define one openAuthor-native event union for sidecar text, desktop voice, hosted control, and mobile |
| Canonical context separated from compact prompt brief | Inspire | Keep full project state available through tools while sending only a bounded model projection |
| Context registry, focus merging, hybrid ranking, and context-candidate lifecycle | Inspire | Replace finance authority/materiality with manuscript authority, narrative proximity, Canon, continuity, and author review |
| Finance intent classifier, domains, multipliers, prompts, and registry indexers | Reject | No code or policy reuse |
| Whole-file conversation store and full persisted tool payloads | Reject | Keep atomic/append storage and retain only model-visible bounded evidence or digests |

The source audit also identified BuildWealth weaknesses that openAuthor must not
copy: no global input-token admission budget, truncation-only history, coarse
registry rebuilds, application-side scans, non-atomic conversation replacement,
answer-level rather than claim-level provenance, and retaining tool output that
the model never saw.

No BuildWealth code may be copied unless all of the following become true:

1. Its ownership and license permit reuse.
2. It has no dependency on BuildWealth database tables, environment variables,
   auth claims, financial types, or prompt wording.
3. Its behavior can be expressed through the Assistant interfaces below.
4. Its tests can be ported with fiction-domain fixtures.
5. The copied code is simpler than an openAuthor-native implementation.

## Target architecture

```text
                         OpenAI Realtime API
                         audio + data channel
                                  ^
                                  |
                    short-lived WebRTC session
                                  |
             +--------------------+--------------------+
             |                                         |
      Desktop Voice Adapter                      Mobile Voice Adapter
      Tauri/WebView + local                      React Native + local
      project access                             encrypted snapshot
             |                                         |
             |                                         |
     Python Assistant Runtime                 Narrow Mobile Adapter
             +--------------------+--------------------+
                                  |
                   Assistant contracts + policy fixtures
                +-----------------+-----------------+
                |                 |                 |
          Context Pack       Tool Registry     Turn Protocol
                |                 |                 |
        Local Project       Approval Rules   encrypted snapshot,
          Adapter                              thread, and outbox

 Mobile only:
   Supabase auth -> Session Gateway -> OpenAI session creation/control
   Encrypted object storage <-> Snapshot Sync <-> desktop/mobile devices
```

The Python Assistant Runtime is the deep module for desktop text and voice. Its
callers should not know how retrieval ranking, token allocation, prompt
serialization, provider events, citations, or approval classification are
implemented. The narrow mobile adapter satisfies the supported subset of the
same versioned contracts and policy fixtures.

### Mobile execution constraint

The Python Assistant Runtime cannot execute inside React Native without adding
a new embedded runtime or rewriting stable domain logic. The privacy-first
mobile path therefore uses a narrow TypeScript Context Pack adapter over a
precomputed snapshot projection. It shares versioned schemas, authority rules,
selection priorities, event vocabulary, and cross-language golden fixtures with
the Python implementation; it does not recreate the full Python project engine.

This is a deliberate tradeoff:

- Privacy-first default: mobile decrypts locally and runs bounded read/search
  tools locally; hosted infrastructure never receives the full project snapshot.
- Runtime-parity alternative: a short-lived hosted worker decrypts the snapshot
  in memory and runs the Python Assistant Runtime, giving exact implementation
  parity but allowing trusted server code to see plaintext during the session.

The privacy-first default is confirmed and implemented. A runtime-parity hosted
worker remains a possible future mode and would require a separate privacy and
security decision. Stored snapshots remain encrypted in either model.

## Module and interface design

### 1. Context Pack module

Proposed location: `openauthor/assistant/context.py`

Primary interface:

```python
def build_context_pack(
  project: ProjectReader,
  request: ContextRequest,
  policy: ContextPolicy,
) -> ContextPack:
  ...
```

`ContextRequest` contains only caller-known facts:

- project and thread identity
- channel: `text`, `desktop_voice`, or `mobile_voice`
- user utterance or current intent
- scope: Book, Scene, Chapter, Character, or Storyline
- current scene and selected text
- explicit scene and Story Memory references
- project revision/snapshot revision

`ContextPolicy` contains normalized selection behavior:

- total input-token ceiling
- reserved history, evidence, tool-output, and response capacity
- nearby-scene radius
- Story Memory inclusion policy
- retrieval mode, limit, minimum score, and freshness requirement
- maximum item count and maximum bytes per item
- channel-specific serialization policy

`ContextPack` is versioned and contains:

```text
schema_version
pack_id
project_id
project_revision
thread_id
channel
scope
items[]
history[]
prompt_brief
resolved_references[]
citations[]
warnings[]
conflicts[]
budget { ceiling, used, remaining, allocations }
freshness { status, stale_sources[] }
degradations[]
trace
created_at
```

Each `ContextItem` contains:

```text
id
kind
source_ref
source_path
source_title
content
content_digest
estimated_tokens
selection_reason
priority
authority
retrieval_score
score_breakdown
source_revision
citation
```

The selection pipeline is deterministic for a fixed project revision:

1. Normalize and validate scope and policy.
2. Reserve capacity for instructions, tool definitions, and response headroom.
3. Resolve bounded opaque `{type,id}` references under the open project and add
   selected text and valid references as pinned evidence. Reject stale,
   mismatched, or unresolved explicit references before starting the turn.
4. Add current-scope anchors and bounded nearby context.
5. Resolve mentioned Story Memory entities.
6. Retrieve query-relevant candidates.
7. Normalize scores, deduplicate overlapping evidence, and prefer fresh sources.
8. Allocate remaining budget by priority and policy.
9. Compile a bounded prompt brief distinct from the canonical selected context;
   keep fuller state available through tools.
10. Produce one manifest for provider serialization and UI inspection.
11. Persist the manifest or a content-addressed reference with the turn.

Context authority, highest first:

1. Current manuscript text and accepted Canon/Codex records
2. Explicit selection and author-selected references
3. Accepted Story Memory facts and project/arc summaries
4. Retrieved chunks and derived summaries
5. Conversation claims not accepted into Canon

Higher-authority conflicts win selection but remain visible in the trace and UI.

The deletion test for this module is strong: without it, text, desktop voice,
mobile voice, generation, and future editorial workflows would each need to
reimplement selection, budgeting, freshness, and provenance.

### 2. History module

Proposed location: `openauthor/assistant/history.py`

Primary interface:

```python
def build_history_window(
  turns: Sequence[RecordedTurn],
  policy: HistoryPolicy,
) -> HistoryWindow:
  ...
```

It replaces the private `_build_provider_history` helper while preserving its
recent contiguous window and role normalization. It also adds:

- Stable token accounting shared with Context Pack budgeting
- Channel-neutral user/assistant/tool turn types
- Optional durable conversation checkpoints for long voice sessions
- Explicit omission reasons when old turns are dropped
- Idempotent handling of partial/final Realtime transcripts
- Stable client-generated turn IDs and explicit `started`, `completed`,
  `stopped`, and `failed` states

Do not add model-generated summaries in the first extraction. Add checkpoints
only after deterministic history parity tests pass; otherwise the refactor and
new summarization behavior become impossible to distinguish.

### 3. Tool Registry module

Proposed location: `openauthor/assistant/tools.py`

Primary interfaces:

```python
def list_tools(channel: AssistantChannel, mode: AssistantMode) -> list[ToolSpec]:
  ...

def handle_tool_call(
  project: ProjectCommands,
  call: ToolCall,
  policy: ToolPolicy,
) -> ToolOutcome:
  ...
```

`ToolOutcome` is one of:

- `completed`: safe read executed and result returned
- `pending_approval`: write/risky action recorded but not executed
- `rejected`: malformed, unavailable, or policy-denied call
- `failed`: execution error with a user-safe message

The same registry emits provider-specific text-chat tool definitions and
Realtime function definitions. Tool names, descriptions, argument schemas,
classification, clipping, and approval requirements have one source of truth.
The registry also records provider capabilities and validates the entire tool
catalog at startup so classification mistakes fail closed.

Initial voice allowlist:

- `scene.list`
- `scene.get`
- `codex.list`
- `codex.get`
- `retrieval.query`
- `check.continuity`
- `proposal.add` or its eventual Change Set equivalent, always pending
- a narrow note/capture tool, always visible and reversible

Merge and direct branch mutation tools remain unavailable to voice initially.

### 4. Turn Recorder module

Proposed location: `openauthor/assistant/turns.py`

Primary interface:

```python
class AssistantTurns:
  def claim(self, command: TurnCommand) -> TurnClaim: ...
  def mark_running(self, turn_id: str, provenance: ProviderProvenance) -> AssistantTurn: ...
  def complete(self, turn_id: str, outcome: TurnOutcome) -> AssistantTurn: ...
  def fail(self, turn_id: str, error: SafeTurnError) -> AssistantTurn: ...
  def interrupt(self, turn_id: str) -> AssistantTurn: ...
  def supersede(self, turn_id: str, replacement_turn_id: str) -> AssistantTurn: ...
  def get(self, turn_id: str) -> AssistantTurn: ...
```

The client-generated `turn_id` is claimed durably before provider invocation.
Reusing the same ID and request digest returns the existing terminal turn;
reusing it for different input fails with `idempotency_conflict`. It owns:

- Partial-to-final transcript transitions
- User, assistant, and tool item ordering
- Context Pack reference and citations
- Provider/model/session provenance
- Usage and latency
- Project/snapshot revision anchor
- Pending tool calls
- Idempotency keys for reconnect/replay
- Semantic turn events shared by every transport

Add the following fields to the durable turn model:

- `channel`
- `voice_session_id`
- `provider_event_id`
- `transcript_status`
- `started_at` and `completed_at`
- `context_pack_id`

Raw audio storage is absent from the schema by default.

The sidecar projects durable state through one transport-neutral channel:

```text
assistant.event {
  event_id
  turn_id
  thread_id
  turn_sequence
  occurred_at
  type: turn.status | output.delta | output.final | tool.status
  data
}
```

### 5. Assistant Runtime module

Proposed location: `openauthor/assistant/runtime.py`

Primary interface:

```python
class AssistantRuntime:
  def prepare(self, request: AssistantRequest) -> PreparedAssistantTurn: ...
  def handle_tool(self, call: ToolCall) -> ToolOutcome: ...
  def record(self, turn: AssistantTurn) -> RecordedTurn: ...
```

Two callers initially cross the Python runtime seam:

- Text Chat Adapter
- Desktop Realtime Adapter

The privacy-first Mobile Realtime Adapter satisfies the supported subset of the
same contracts with a local TypeScript implementation. Under the optional
runtime-parity model, it calls a hosted Python Assistant Runtime instead.

Text chat continues to own provider invocation for request/response models.
Realtime adapters own connection/event translation. The runtime owns project
meaning and policy.

### 6. Project Reader/Commands seam

Two adapters make this a real seam:

- `LocalProjectAdapter`: current Python scene, Codex, retrieval, continuity,
  proposal, revision, and thread functions.
- `SnapshotProjectAdapter`: read-only mobile project projection plus an
  encrypted outbox for captures and pending changes.

The mobile adapter must not imitate the entire Python engine. It implements the
small subset required by the initial mobile tool allowlist.

## Context strategy for Realtime voice

Long voice sessions must not preload or repeatedly resend a complete book.

### Session bootstrap

The initial Context Pack should contain:

- Assistant behavior and author-safety instructions
- Project title, synopsis, genre, and style profile summary
- Current scope identity and compact metadata
- Current scene or selected text when explicitly in scope
- A compact Book scene index or chapter index
- A compact set of relevant Story Memory entries
- A bounded recent thread history
- Tool definitions and approval rules

The Context Pack allocator budgets the whole model input, not each section in
isolation: instructions, enabled tool schemas, explicit references, prompt
brief, retrieval, history, current utterance, Realtime overhead, and reserved
output all share one ceiling. Every dropped or truncated item is recorded.

### On-demand context

Full scene bodies, larger Story Memory records, continuity reports, and broad
search results are loaded through function tools. Tool results must return
source references and content digests so the final turn can cite exactly what
the model saw.

### Context refresh

Rebuild or amend the session context when:

- The author changes Assistant scope
- The active scene changes
- A Change Set is accepted or a Revision is restored
- Story Memory changes
- The mobile snapshot revision changes
- Retrieval freshness changes materially

Do not silently inject every filesystem update into an active speaking turn.
Queue the refresh and apply it between turns, recording the new project
revision in subsequent Context Packs.

### Conversation compaction

Realtime model context and openAuthor thread history are separate concerns.
The durable thread remains complete. The live model session receives:

1. A recent contiguous turn window
2. Unresolved pending actions and author constraints
3. An optional checkpoint summarizing older conversation

Checkpoint generation is a later optimization. It must be source-linked to the
turn IDs it summarizes, stored as derived intelligence, and regenerated when
those turns are edited or truncated.

## Desktop voice implementation

### Frontend

Proposed location: `desktop/src/voice/`

Modules:

- `voiceSession.ts`: session state machine and commands
- `realtimeTransport.ts`: `RTCPeerConnection`, audio tracks, data channel
- `realtimeEvents.ts`: typed OpenAI-event translation
- `voiceAudio.ts`: output element, mute, route/error handling
- `voiceTranscript.ts`: partial/final transcript reducer
- `voiceSession.test.ts`: deterministic event-sequence tests

`ChatPanel.tsx` receives a small `VoiceControl` interface and renders:

- Start/end voice
- Connecting/listening/thinking/speaking state
- Mute and interrupt
- Live partial transcript
- Recoverable connection errors
- Session usage/time indicator

The voice implementation must not grow directly inside `ChatPanel.tsx`.

### Local sidecar

Add versioned methods to `openauthor/server.py`:

- `voice.session.start`
- `voice.session.end`
- `voice.context.prepare`
- `voice.tool.handle`
- `voice.turn.record`

The local sidecar:

- Reads the locally stored OpenAI API credential through the existing secure
  credential path or a new OS-keychain adapter.
- Exchanges the WebRTC offer or requests a short-lived session grant.
- Returns only short-lived negotiation material to the WebView.
- Executes local read tools and records pending writes.
- Never proxies the microphone audio stream.

### Packaging

Add and verify:

- macOS microphone usage text
- Hardened-runtime audio-input entitlement where required
- Permission-denied recovery UI
- First-run microphone test
- Signed/notarized build behavior

Windows support follows the same Assistant and transport interfaces, but its
device and installer permission behavior requires a separate release gate.

## Realtime session behavior

Official OpenAI documentation recommends WebRTC rather than WebSockets when a
client such as a browser or mobile device connects to Realtime. The documented
session paths support either ephemeral credentials or a unified server-mediated
WebRTC initialization. See [Realtime API with WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc).

Initial policy:

- Select the model through server/local configuration; do not hard-code it in
  UI code.
- Use semantic VAD with conservative eagerness for author dictation, then tune
  from measured interruption and turn-latency data.
- Enable response creation and interruption between normal conversation turns.
- Permit user barge-in and stop output immediately on interruption.
- Use Realtime function tools for openAuthor-owned project behavior.
- Disable tools not included in the channel allowlist.

OpenAI documents `server_vad` and `semantic_vad`, including automatic response
creation and response interruption; see
[Voice activity detection](https://developers.openai.com/api/docs/guides/realtime-vad).
OpenAI also documents application-executed Realtime function tools and
`function_call_output`; see
[Realtime with tools](https://developers.openai.com/api/docs/guides/realtime-mcp).

## Session Gateway

The hosted Session Gateway is required for mobile and optional for desktop.

Primary interface:

```text
POST /v1/realtime/sessions
Authorization: Bearer <Supabase access token>

request:
  project_id
  device_id
  sdp

response:
  call_id (when supplied upstream)
  sdp
  expires_at
  request_id
```

The implemented gateway intentionally accepts no client model, voice,
instructions, or tool policy. Thread, scope, Context Pack, policy version,
maximum duration, and usage metadata can be added only as authenticated,
server-validated control-plane fields; they must not become a way to widen the
server-owned Realtime policy.

Responsibilities:

- Validate Supabase identity and workspace/project membership
- Enforce model, voice, duration, concurrency, and spend policy
- Create short-lived Realtime sessions without exposing a permanent API key
- Record content-free operational telemetry
- Revoke or terminate sessions
- Optionally attach a sideband control connection

Permanent OpenAI keys never enter the desktop WebView, mobile application, or
repository. Mobile cannot reuse the local Codex/ChatGPT subscription login.

OpenAI's sideband design allows an application server to monitor a WebRTC
session, update instructions, and respond to tool calls; see
[Webhooks and server-side controls](https://developers.openai.com/api/docs/guides/realtime-server-controls).

For the encrypted-snapshot mobile design, project read tools execute on the
mobile device. The Gateway still controls session issuance and allowed session
policy. The narrow mobile selector and tool adapter must pass the shared context
fixtures. A hosted sideband tool executor is deferred until openAuthor
deliberately chooses the runtime-parity privacy model described above.

Creation-time policy clamping alone is not continuous enforcement: a connected
client can send later Realtime control events. Production rollout therefore
requires either a server sideband policy monitor or a deliberately constrained
client-event contract plus server-observable enforcement. Local tool adapters
must fail closed regardless. This gate is tracked as VM-006.

## Encrypted snapshot and sync foundation

### Privacy decision

The recommended first mobile design keeps synchronized project content opaque
to Supabase and the Session Gateway:

- Desktop creates a versioned project snapshot.
- Snapshot payload is encrypted before upload.
- Authorized devices receive or derive a project data key through a documented
  device-key enrollment process.
- Mobile decrypts into an application-private local cache.
- Realtime receives only the context selected for the active session.
- OpenAuthor's hosted infrastructure does not retain plaintext manuscript data.

This is encrypted sync, not a claim that model inference is end-to-end
encrypted: selected transcript and context are sent to the configured model
provider during an opted-in voice session.

### Snapshot contract

Versioned snapshot contents:

- Project identity and revision
- Structure: acts, chapters, scenes, beats, synopsis, themes, style
- Scene metadata and bodies needed for mobile read/search
- Accepted Story Memory and evidence references
- Compact continuity/open-question projection
- Thread metadata and selected recent turns
- Search projection or deterministic data from which mobile can rebuild it
- Content digests and tombstones

Runtime caches, provider credentials, raw audio, local paths, and unrelated
generation logs are excluded.

The snapshot also includes the precomputed normalized evidence projection used
by the narrow mobile Context Pack adapter: stable reference IDs, authority,
source revision/digest, compact searchable text, citation metadata, and policy
version. This avoids rebuilding the complete Python domain model on mobile.

### Sync metadata

Add hosted metadata for:

- devices and public keys
- project snapshot manifests
- encrypted object references
- encrypted outbox envelopes
- per-device acknowledged revision
- revocation and key rotation

Existing workspace/project RBAC remains the authorization source. RLS must be
extended to every new metadata table. Encrypted blob storage uses short-lived,
project-scoped signed operations.

### Mobile outbox

Mobile-originated operations are immutable envelopes:

- capture note
- dictated passage for inbox review
- pending Story Memory suggestion
- pending Change Set request
- thread turn/transcript
- review decision where permitted

Each envelope includes operation ID, device ID, project base revision,
timestamp, type, encrypted payload, and payload digest. Desktop import is
idempotent. Stale write-like operations become review items or conflicts; they
never overwrite current prose automatically.

## Mobile application

### Technology choice

Create a React Native application with native WebRTC and secure key storage.
Share generated contracts, context fixtures, event reducers where practical,
and visual tokens. Do not attempt to reuse the Tauri shell or bundled Python
runtime on mobile.

Proposed repository evolution:

```text
contracts/                 Versioned JSON Schema and generated types
desktop/                   Existing Tauri application
mobile/                    React Native companion
openauthor/assistant/      Shared Python Assistant policy/runtime
gateway/                   Hosted Session Gateway
supabase/migrations/       Identity, device, snapshot, outbox metadata
```

The repository need not become a JavaScript monorepo before mobile work begins.
Introduce a workspace only when shared TypeScript packages actually exist.

### Initial screens

1. Sign in and enroll device
2. Project list and sync state
3. Project home with snapshot freshness
4. Assistant thread list
5. Voice/text Assistant
6. Capture inbox
7. Read-only scene and Story Memory views
8. Pending Change Set review
9. Privacy, storage, voice, and cost settings

### Mobile audio constraints

The mobile voice adapter must handle:

- Microphone permission and denial recovery
- Speaker, receiver, wired headset, and Bluetooth routes
- Audio focus loss and phone-call interruption
- App foreground/background transitions
- Network handoff and reconnect
- Duplicate or out-of-order Realtime events
- Explicit end-session cleanup
- Foreground-only sessions in the first release

Push-to-talk is an acceptable early transport validation, but the product
milestone is a full-duplex session with natural interruption.

## Delivery phases

### Phase 0 — Decisions, fixtures, and contracts

Work:

- Review the completed BuildWealth adoption matrix and keep every candidate on
  the independent-reimplementation path unless ownership and license evidence
  is later supplied.
- Record decisions for privacy model, billing, raw-audio retention, mobile scope,
  and iOS/Android sequencing.
- Create JSON Schemas for Context Pack, Assistant Turn, Tool Call/Outcome,
  Voice Session, Project Snapshot Manifest, and Outbox Envelope.
- Create fiction-domain context fixtures covering scene, chapter, character,
  Storyline, explicit mentions, stale retrieval, and long history.
- Capture current `chat.py` outputs as parity fixtures before refactoring.

Exit criteria:

- Schemas validate in Python and TypeScript.
- Existing chat context behavior has deterministic golden fixtures.
- No BuildWealth source has been copied without approved ownership, license,
  attribution, and test-porting evidence.
- No runtime code depends on BuildWealth.

### Phase 1 — Assistant Runtime extraction

Work:

- Create `openauthor/assistant/` modules.
- Move context selection and history behavior behind their new interfaces.
- Move tool schema/classification/execution behind Tool Registry.
- Move turn persistence behind Turn Recorder.
- Keep `send_chat_message` as a compatibility adapter.
- Add Context Pack identifiers and manifests to new turns.
- Generate or validate frontend contracts rather than extending ad hoc types.

Exit criteria:

- Existing text-chat tests pass unchanged or with contract-only updates.
- Golden fixtures select the same sources and history as before.
- Context Pack never exceeds its configured budget.
- Tool approval behavior is unchanged.
- `chat.py` orchestrates text chat instead of owning context/tool details.
- Full prompt/manuscript logging is opt-in or development-only; normal turn
  provenance stores bounded model-visible evidence or digests.

### Phase 2 — Desktop voice technical slice

Work:

- Add microphone packaging permissions.
- Implement WebRTC and typed Realtime event translation.
- Add local `voice.*` sidecar methods.
- Add a minimal VoiceControl to ChatPanel.
- Start/end session, stream audio, play output, show partial/final transcripts.
- Persist final turns into the active Assistant thread.
- Implement mute, interrupt, error, and cleanup behavior.

Initial limitation:

- Read tools may execute; write-like requests can only create a pending proposal
  for visual approval and cannot mutate manuscript state.
- Advanced/feature-flagged UI.
- One active voice session per project process.

Exit criteria:

- Permanent API credentials are absent from frontend state and logs.
- Text and voice turns appear in correct durable order without duplicates.
- Interrupt stops playback and marks the interrupted turn correctly.
- Permission denial and failed negotiation recover without restarting the app.
- A fake Realtime adapter drives deterministic UI and sidecar tests.

### Phase 3 — Desktop voice product slice

Work:

- Enable semantic VAD and tune it with author speech fixtures.
- Enable on-demand read tools and cited context.
- Allow voice to queue a note or Change Set for visual review.
- Add scope changes and context refresh between turns.
- Add usage/time visibility and local budget controls.
- Add reconnect and session-expiry behavior.
- Add an inspectable voice Context Pack view.

Exit criteria:

- Voice can answer a scene-specific and Book-wide question with source chips.
- Voice can prepare but cannot apply a manuscript change.
- Every completed response records project revision, Context Pack, model, usage,
  transcript, and tool outcomes.
- Context and tool behavior are parity-tested against text chat.

### Phase 4 — Hosted Session Gateway

Work:

- Implement Supabase token and membership validation.
- Implement Realtime session creation with short-lived credentials or SDP
  exchange.
- Add per-user concurrency, duration, and spend limits.
- Add content-free session telemetry and administrative kill switch.
- Add abuse/error handling and key rotation.
- Validate desktop optionally through the hosted issuer before mobile depends on
  it.

Exit criteria:

- A mobile-shaped test client can create a session without a permanent key.
- Unauthorized project/session requests fail closed.
- Session policy cannot be widened by client input.
- Limits and revocation are integration-tested.
- Logs contain no manuscript, transcript, tool result, or credential content.

### Phase 5 — Encrypted snapshots and outbox

Work:

- Implement device enrollment and project key distribution.
- Generate deterministic, versioned desktop snapshots.
- Encrypt, upload, download, verify, decrypt, and cache snapshots.
- Add tombstones, acknowledged revisions, and device revocation.
- Implement immutable encrypted outbox envelopes and idempotent desktop import.
- Add sync status, manual disable, remote-data deletion, and recovery UX.

Exit criteria:

- Supabase and object storage contain no plaintext manuscript data.
- A second device can enroll, download, verify, and decrypt an authorized
  snapshot.
- A revoked device cannot download new snapshots or unwrap rotated keys.
- Replaying an outbox envelope does not duplicate the resulting local artifact.
- Stale write-like operations enter review/conflict flow rather than overwrite.
- Disabling sync leaves the local project fully usable.

### Phase 6 — Mobile voice and capture companion

Work:

- Create the React Native application and generated contracts.
- Add auth, device enrollment, project download, local cache, and sync state.
- Implement SnapshotProjectAdapter and local search/read tools.
- Implement WebRTC voice through the Session Gateway.
- Add text chat using the same Context Pack and thread model.
- Add encrypted capture/outbox behavior.
- Add foreground audio interruption and reconnect handling.

Exit criteria:

- The app remains useful for reading and capture while offline.
- Mobile voice answers against the downloaded snapshot and displays citations.
- Mobile cannot directly mutate manuscript prose.
- Captures arrive once in the desktop inbox after reconnection.
- Snapshot revision is visible in every mobile Assistant turn.
- Deleting local mobile data removes decrypted project content and keys.

### Phase 7 — Mobile review and product hardening

Work:

- Add Change Set review, hunk decisions, and conflict explanations.
- Add Story Memory suggestion review where the role permits it.
- Add accessibility, audio-device, low-bandwidth, and long-session testing.
- Add privacy export/deletion and cost controls.
- Run App Store/Play policy, security, and recovery reviews.

Exit criteria:

- Review decisions preserve attribution and revision semantics.
- No mobile code path bypasses Change Set or Story Memory approval.
- Lost/replaced device and key-recovery drills pass.
- Product metrics justify deciding whether to invest in full mobile editing.

## Verification strategy

### Context quality

- Golden Context Pack fixtures by scope and project revision
- Budget-exhaustion and oversized-source tests
- Retrieval stale/missing/required degradation tests
- Explicit reference precedence tests
- Deduplication and overlapping-chunk tests
- Citation-to-content-digest verification
- Text/desktop source-selection parity tests
- Cross-language privacy-first mobile policy fixtures for its supported source
  and tool subset
- Fiction-domain relevance set with expected top evidence and unacceptable
  omissions

### Realtime behavior

- Fake event stream covering normal turn, partial transcripts, tool call,
  interruption, cancellation, reconnect, duplicate event, out-of-order event,
  expiry, and provider error
- State-machine property tests: one active state, terminal cleanup, idempotent
  finalization
- Audio fixture tests for short pause, long pause, self-correction, trailing
  thought, interruption, and noisy environment
- Manual Bluetooth/headset and OS interruption matrix

### Safety and privacy

- Permanent credential scan of frontend bundles and logs
- Tool allowlist and approval-classification tests
- Attempted voice write cannot produce direct manuscript mutation
- Gateway authorization and RLS tests
- Ciphertext-only hosted storage inspection
- Device revocation and key rotation drills
- Transcript/raw-audio retention audit

### Sync correctness

- Snapshot digest and corruption tests
- Offline edits/captures followed by reconnect
- Duplicate and reordered outbox delivery
- Desktop revision advances while mobile is offline
- Removed scene/entity tombstones
- Partial upload/download recovery
- User disables sync and requests hosted-data deletion

## Operational targets

Targets must be measured separately by platform and network class.

- Session setup p95: at most 3 seconds on a healthy broadband connection
- End-of-user-turn to first assistant audio p50: at most 1.5 seconds
- Barge-in to stopped assistant audio p95: at most 500 ms
- Final transcript persistence: 100% for normally ended sessions
- Duplicate durable turns after reconnect: 0
- Context budget violations: 0
- Direct manuscript writes initiated by voice: 0
- Citation source/digest validity: 100%
- Gateway plaintext manuscript/transcript logging: 0

These are release gates, not provider guarantees. Record provider, model,
platform, network class, and session policy with latency measurements.

## Migration and compatibility

- Existing JSONL thread files remain readable.
- New turn fields are optional for historical records.
- Existing `context_used` can be retained while new turns additionally point to
  a versioned Context Pack.
- `send_chat_message` remains callable throughout the Assistant extraction.
- Existing providers continue using Text Chat Adapter; Realtime is a separate
  provider/channel choice.
- Existing projects require no cloud migration to use desktop text chat or
  local functionality.
- Snapshot schemas are versioned independently from the local project schema.

## Risks and mitigations

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Voice and text choose different context | Confusing or unsafe Assistant behavior | One desktop Context Pack module plus cross-language mobile policy fixtures |
| Realtime session accumulates too much context | Cost, latency, and relevance degradation | Small bootstrap pack, on-demand tools, measured compaction |
| VAD interrupts thoughtful speakers | Frustrating author experience | Semantic VAD, conservative tuning, visible manual controls |
| Mobile requires plaintext hosted projects | Weakens local-first trust | Encrypted snapshots and device-local project adapter |
| Client-side mobile tools widen policy | Unauthorized behavior or spend | Server-issued session policy, strict local allowlist, pending writes only |
| Reconnect duplicates turns or operations | Corrupted history or repeated captures | Provider event IDs and application idempotency keys |
| BuildWealth patterns import hidden assumptions | Cross-project coupling and incorrect context | Adoption matrix, independent implementations, fiction-domain fixtures |
| API voice cost surprises users | Loss of trust and margin | Visible usage, duration limits, quotas, explicit billing model |
| Mobile scope becomes a full editor | Long delay before useful release | Companion-first scope and Phase 7 evidence gate |
| Sync conflict silently overwrites prose | Data loss | Immutable outbox plus Change Set/conflict review |

## Product and architecture decisions still required

1. Desktop billing: user-supplied OpenAI key, openAuthor-hosted credits, or both?
2. Mobile billing: bundled allowance, metered usage, or subscription tier?
3. Platform sequence: iOS first or iOS and Android together?
4. Snapshot scope: full manuscript bodies or user-selectable mobile availability?
5. Transcript sync: all Assistant turns or opt-in per project/thread?
6. Hosted sideband: session policy only, or future server-readable project
   execution after a separate privacy decision?
7. Voice rollout: Advanced experiment, private beta, or active roadmap phase?

Recommended defaults:

- Support desktop user-supplied keys first; mobile uses hosted issuance and
  explicit quotas.
- Keep the implemented privacy-first local mobile adapter; any transient hosted
  plaintext access requires separate approval.
- Use the implemented device enrollment, independently sealed key envelopes,
  and printable recovery key. Add interactive trusted-device approval before a
  broad production rollout.
- Start with iOS if staffing cannot support both native audio matrices well.
- Sync complete project snapshots for selected projects, encrypted and opt-in.
- Sync text transcripts but never raw audio by default.
- Keep project tools device-local until a server-readable hosted mode is
  separately approved.
- Release desktop voice privately before activating the mobile roadmap.

## Implementation ticket status

| # | Ticket | Status at this checkpoint |
| --- | --- | --- |
| 1 | Add generated Context Pack schemas and cross-language parity fixtures | Complete locally |
| 2 | Extract history window with unchanged tests | Complete locally |
| 3 | Extract Context Pack builder with unchanged source selection | Complete locally |
| 4 | Extract Tool Registry and approval classification | Complete locally |
| 5 | Add Turn Recorder idempotency and channel fields | Complete locally |
| 6 | Convert text chat into the first Assistant Runtime adapter | Complete locally |
| 7 | Add fake Realtime adapter and voice session state machine | Complete locally |
| 8 | Add local WebRTC negotiation and microphone packaging | Complete locally; signed native verification pending |
| 9 | Persist final voice turns in existing threads | Complete locally |
| 10 | Add read tools and cited on-demand context | Complete locally across desktop and mobile adapters |
| 11 | Add pending note/Change Set actions | Complete locally; all mobile writes remain review-only |
| 12 | Run the desktop private-beta gate | Pending live Realtime and signed-app evidence |
| 13 | Add a hosted Session Gateway | Complete locally; deployment, billing, and continuous enforcement remain |
| 14 | Add deterministic encrypted mobile snapshot sync | Complete locally; hosted bucket/policy deployment remains |
| 15 | Add device enrollment, sealed project keys, rotation, recovery, and revocation | Complete locally; hosted and lost-device drills remain |
| 16 | Build the Expo mobile companion and local SnapshotProject adapter | Complete locally; signed physical-device validation remains |
| 17 | Add mobile Realtime voice/text, citations, interruption, and transcripts | Complete locally; live API/audio matrix remains |
| 18 | Add encrypted capture/review outbox and desktop inbox | Complete locally; hosted end-to-end conflict/replay drill remains |

## Source references

Local primary sources:

- `openauthor/chat.py`
- `openauthor/assistant/context.py`
- `openauthor/assistant/history.py`
- `openauthor/assistant/runtime.py`
- `openauthor/assistant/snapshots.py`
- `openauthor/assistant/tool_runs.py`
- `openauthor/assistant/tools.py`
- `openauthor/assistant/turns.py`
- `openauthor/retrieval.py`
- `openauthor/server.py`
- `tests/test_chat_module.py`
- `tests/test_retrieval_module.py`
- `desktop/src/components/secondary/ChatPanel.tsx`
- `desktop/src/api.ts`
- `desktop/src/assistantEvents.ts`
- `desktop/src/types.ts`
- `desktop/src/voice/realtimeTransport.ts`
- `desktop/src/voice/voiceSession.ts`
- `desktop/src/mobileSync/mobileSync.ts`
- `desktop/src/mobileSync/hostedCoordinator.ts`
- `desktop/src/mobileSync/supabaseTransport.ts`
- `desktop/src/mobileSync/projectKeyProvisioning.ts`
- `desktop/src-tauri/tauri.conf.json`
- `gateway/src/sessionGateway.ts`
- `gateway/src/config.ts`
- `gateway/src/production.ts`
- `gateway/src/supabaseAuth.ts`
- `gateway/src/mobilePolicy.ts`
- `mobile/App.tsx`
- `mobile/src/app/hostedRuntime.ts`
- `mobile/src/core/hostedLifecycle.ts`
- `mobile/src/core/snapshotProject.ts`
- `mobile/src/core/snapshotSync.ts`
- `mobile/src/core/mobileAssistant.ts`
- `mobile/src/core/voiceController.ts`
- `contracts/schemas/`
- `supabase/migrations/20260225180000_project_registry_rbac.sql`
- `supabase/migrations/20260830190000_mobile_encrypted_sync.sql`
- `supabase/migrations/20260830193000_mobile_encrypted_sync_storage.sql`
- `docs/chat-redesign.md`
- `docs/product-development-plan.md`
- `docs/research/buildwealth-context-management.md`

Official OpenAI documentation:

- [Realtime API with WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [Voice activity detection](https://developers.openai.com/api/docs/guides/realtime-vad)
- [Realtime with tools](https://developers.openai.com/api/docs/guides/realtime-mcp)
- [Webhooks and server-side controls](https://developers.openai.com/api/docs/guides/realtime-server-controls)
