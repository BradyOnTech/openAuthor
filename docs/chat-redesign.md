# Chat Redesign Plan

North star: chat in openAuthor is not a generic LLM chat. It is an editorial
workflow with a conversation attached. Every turn is accountable to the
manuscript: it knows what context it saw (scenes, codex, retrieval citations),
what it cost, and what it proposes to change — and manuscript changes only land
through the proposal queue.

Reference points come from studying t3code (pingdotgg/t3code): persistent
provider sessions instead of process-per-message, the turn as the durable unit
of work, typed ordered streaming events, and git checkpoints per turn. We adapt
those ideas to authoring rather than cloning a coding agent.

## Phase 1 — Conversation correctness and accountability (Python only) — DONE

- Send conversation history to the provider. Threads currently persist
  messages but each turn sends only `[system, current user message]`; the
  model has no memory. Build a token-budgeted, contiguous window of prior
  turns (newest first) and pass it through `complete_chat` to every provider.
  Tool results are folded into history as user-role notes so the model can
  reference earlier tool output.
- `history_token_budget` joins the thread context profile (override per
  message like the other knobs; `0` disables history).
- Route chat turns through the budget and provenance pipeline. Chat calls
  `enforce_generation_budget` before the provider call (fail-closed, same as
  proposal generation) and writes a generation log (`kind: "chat"`, with
  `thread_id`) for success, provider failure, and budget rejection. Chat spend
  then shows up in `generation list` / `generation budget` automatically.

## Phase 2 — Persistent sidecar session with streaming — DONE (chat surface)

- `openauthor serve` (`openauthor/server.py`): long-running JSON-RPC over
  stdin/stdout — `ping`, `chat.send`, `chat.interrupt`; ordered `chat.delta`
  event frames with monotonic sequence numbers.
- Tauri spawns the sidecar once per project (`sidecar_request` command in
  `lib.rs`), forwards event frames to the frontend on
  `openauthor://sidecar-event`; the chat UI renders tokens as they arrive,
  echoes the user message optimistically, and offers a Stop button.
- Provider layer streams behind the existing `_call_provider` seam via an
  `on_delta` callback (SSE for openai/openrouter/openai-codex/anthropic;
  chunked emission for local). Budget enforcement and generation logging are
  identical on both paths.
- Remaining: thread/message list reads still go through one-shot CLI
  subprocesses; migrate them to sidecar methods when convenient.

## Phase 3 — Native tool calling and turn checkpoints

- Replace the `[[OA_TOOL_CALLS_BEGIN]]` text-sentinel protocol with native
  provider function calling, with a real tool loop (model sees tool results
  and continues within the turn). Keep the read/write/risky classification
  and pending-approval gate.
- Anchor agent-mode turns to manuscript state: record a snapshot ref at turn
  start/complete (the thread's `vcs_branch`/`vcs_base_commit` fields already
  exist), and expose a per-turn manuscript diff.

## Phase 4 — UI pass

- Markdown rendering, optimistic user-message echo, retry/regenerate/copy.
- Real context pickers for scenes and codex entities (the API already accepts
  explicit ids); retrieval on by default with citations rendered as clickable
  chips back to the source scene/codex entry.
- "Turn this reply into a proposal" affordance on assistant messages.
- Surface per-thread spend (from generation logs) in the thread header.
