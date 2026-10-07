# CLI reference

The Python core is a standalone CLI. The desktop app calls these commands and parses their `--json` output. Run any command with `python3 -m openauthor ...`, or install with `pip install -e .` and use `openauthor`.

See the [README](../README.md) for an overview and [desktop-architecture.md](desktop-architecture.md) for how the desktop bridge maps to these commands.


```bash
# initialize in current folder
python3 -m openauthor init .

# add and list scenes
python3 -m openauthor scene add --title "Opening Scene" --summary "Introduce protagonist" --pov "Elara"
python3 -m openauthor scene list
python3 -m openauthor scene list --json
python3 -m openauthor scene get --id scene-0001 --json
python3 -m openauthor scene update --id scene-0001 --summary "Tighter opening" --body "Updated body" --json

# preview structure, import a real manuscript, and export with a loss report
python3 -m openauthor manuscript preview --source "/path/to/novel.docx" --strategy auto --json
python3 -m openauthor manuscript import --source "/path/to/novel.docx" --strategy headings --json
python3 -m openauthor manuscript export --format markdown --target "/path/to/empty-export-folder" --json
python3 -m openauthor manuscript export --format docx --target "/path/to/novel-export.docx" --json

# add and list codex entities
python3 -m openauthor codex add --type character --name "Elara" --description "Main POV character"
python3 -m openauthor codex list --type character
python3 -m openauthor codex list --json
python3 -m openauthor codex get --id entity-xxxxxxxxxxxx --json
python3 -m openauthor codex update --id entity-xxxxxxxxxxxx --description "Updated profile" --json

# create, draft, and apply proposal cards
python3 -m openauthor proposal add --title "Tighten prose" --instruction "Make paragraph one more direct" --scene scene-0001
python3 -m openauthor proposal list --status pending
python3 -m openauthor proposal draft --id proposal-xxxxxxxxxxxx --provider local --json   # generate the full revised scene body
python3 -m openauthor proposal apply --id proposal-xxxxxxxxxxxx                            # fails closed; records before/after revisions; refuses stale drafts unless --force
python3 -m openauthor proposal undo --id proposal-xxxxxxxxxxxx                             # restores the pre-apply scene and records the undo as a new revision

# generate proposal using local provider (real deterministic adapter)
python3 -m openauthor proposal generate --scene scene-0001 --instruction "Tighten pacing and keep POV voice" --provider local --json

# retrieval-backed generation (requires built retrieval index)
python3 -m openauthor retrieval build --json
python3 -m openauthor proposal generate --scene scene-0001 --instruction "Tighten pacing and keep POV voice" --provider local --retrieval-mode required --retrieval-limit 5 --json

# generate proposal using OpenAI or Anthropic (requires API keys)
OPENAI_API_KEY=... python3 -m openauthor proposal generate --scene scene-0001 --instruction "Improve dialogue clarity" --provider openai --model gpt-4.1-mini --json
ANTHROPIC_API_KEY=... python3 -m openauthor proposal generate --scene scene-0001 --instruction "Increase tension" --provider anthropic --json

# or use an existing ChatGPT/Codex plan through the official Codex app-server
python3 -m openauthor auth login --provider openai-codex --json
python3 -m openauthor proposal generate --scene scene-0001 --instruction "Increase tension" --provider openai-codex --json

# inspect generation runs and failures
python3 -m openauthor generation list --json
python3 -m openauthor generation list --status failed --json
python3 -m openauthor generation list --provider openai --json
python3 -m openauthor generation list --quality low --json
python3 -m openauthor generation get --id gen-xxxxxxxxxxxx --json
python3 -m openauthor generation rerun --id gen-xxxxxxxxxxxx --json
python3 -m openauthor generation rerun --id gen-xxxxxxxxxxxx --retrieval-mode required --retrieval-require-fresh --json
python3 -m openauthor generation pin --scene scene-0001 --run gen-xxxxxxxxxxxx --json
python3 -m openauthor generation pins --json
python3 -m openauthor generation unpin --scene scene-0001 --json
python3 -m openauthor generation budget --json
python3 -m openauthor generation budget --max-output-tokens 700 --daily-tokens 120000 --json
python3 -m openauthor generation budget --reset --json
python3 -m openauthor generation config --json

# create an optional Git snapshot for advanced branch workflows
python3 -m openauthor snapshot create -m "Draft scene and codex seed"
python3 -m openauthor snapshot log

# branch workspace primitives
python3 -m openauthor branch list --json
python3 -m openauthor branch create --name exp-arc-a --json
python3 -m openauthor branch switch --name main --json
python3 -m openauthor branch diff --base main --head exp-arc-a --json
python3 -m openauthor branch preflight --base main --head exp-arc-a --json
python3 -m openauthor branch merge --base main --head exp-arc-a --json

# merge-conflict workflow (scan -> AI reconciliation -> merge with resolutions)
python3 -m openauthor branch conflicts --base main --head exp-arc-a --json
python3 -m openauthor branch resolve --base main --head exp-arc-a --path manuscript/scenes/0001-opening-scene.md --provider local --json
python3 -m openauthor branch merge --base main --head exp-arc-a --resolution proposal-xxxxxxxxxxxx --json

# retrieval index + query
python3 -m openauthor retrieval status --json
python3 -m openauthor retrieval build --json
python3 -m openauthor retrieval query --text "ember cipher vault routes" --limit 5 --json
python3 -m openauthor retrieval query --text "ember cipher" --require-fresh --json

# run continuity checks
python3 -m openauthor check continuity
python3 -m openauthor check continuity --json

# workspace drift/migration audit + safe repair
python3 -m openauthor check workspace --json
python3 -m openauthor check workspace --repair --json

# launch-critical project health + guided safe repair
python3 -m openauthor check startup --json
python3 -m openauthor check startup --repair --json

# performance baselines for scenes/proposals/runs/retrieval status
python3 -m openauthor check performance --repeat 3 --json
```

`snapshot create` stages only authoring artifacts:

- `manuscript/scenes/`
- `.openauthor/project.json`
- `codex/codex.json` (exported from SQLite on snapshot)
- `.openauthor/provider_pricing.json`
- `.openauthor/generation_budget_policy.json`

Workspace artifacts (project-scoped but not snapshot-versioned by default):

- `.openauthor/workspace/proposals/*.json`
- `.openauthor/workspace/chats/threads.json`
- `.openauthor/workspace/chats/threads/*.jsonl`

Codex synchronization behavior:

- Codex mutations (`codex add/update`) now keep `codex/codex.json` in sync immediately.
- Branch switch/merge operations resync runtime SQLite codex state from branch `codex/codex.json` to prevent cross-branch codex drift.

AI generation artifacts:

- `.openauthor/generations/*.json` stores prompt/context/usage logs per run.
- `.openauthor/provider_pricing.json` controls model pricing for cost estimation metadata.
- `.openauthor/generation_budget_policy.json` stores fail-closed budget limits for generation.
- `.openauthor/retrieval/index.json` stores deterministic local retrieval chunks/term stats for provenance-backed querying.
- Branch workspace merge preflight analyzes overlapping changes in book-state artifacts (scenes, codex snapshot, project/budget metadata).
- Desktop Merge panel supports storyline create/switch, compatibility checks (preflight + conflict scan), per-scene AI reconciliation drafts routed through the proposal queue, and merge apply with resolutions.
- Failed provider calls are also logged to `.openauthor/generations/*.json` with error category metadata.
- Logs include normalization diagnostics (detected headers, filled sections, changed/unchanged normalization).
- Logs and summaries include quality scoring metadata (`quality_score`, `quality_tier`, `quality_flags`).
- Retrieval-backed generations attach provenance metadata (`retrieval` query/mode/index state + citation chunks) to both generation logs and proposal generation payloads.
- Logs also persist generation settings (`temperature`, `max_output_tokens`, `context_scene_radius`, `codex_limit`) for reproducible reruns.
- Generation is blocked fail-closed when configured per-run or rolling budget caps would be exceeded; budget violations are logged as failed generation runs with policy/usage details.
- The active desktop Budget panel includes policy controls (view/update/reset) plus daily/weekly usage visibility for recovery when generation is budget-blocked.
- The active proposal generator exposes retrieval controls, while Assistant chat displays cited context. Advanced run-level provenance remains a core capability awaiting a V2 product surface.
- Conversational voice and the read/chat/capture/review mobile companion are active development, with a shared native/browser delivery path. See `docs/voice-mobile-build-plan.md`; live voice, hosted sync, and physical-device release validation remain open.
- Preferred runs can be pinned per scene via generation pin/unpin commands and are surfaced in runs metadata (`preferred_for_scene`).
- Generation rerun, comparison, pinning, and export primitives exist in the core or tested helpers but are hidden from the active V2 product pending a coherent revision-history experience.
- Workspace audit/repair and performance baselines are currently CLI-only release tools.
- Proposal review supports triage queue modes (`all`, `selected scene first`, `preferred-linked first`, `preferred-linked only`) plus status filters.
- Preferred-pipeline helper logic remains available for future revision-history work; it is not claimed as a shipped V2 workflow.

Generated proposal format is normalized to four sections for review consistency:

- `Intent`
- `Constraints`
- `Edit Plan`
- `Continuity Notes`

Provider retry tuning (optional env vars):

- `OPENAUTHOR_PROVIDER_MAX_RETRIES` (default `2`)
- `OPENAUTHOR_PROVIDER_RETRY_BASE_MS` (default `350`)

ChatGPT subscription integration:

- Packaged macOS builds include a checksum-pinned Codex app-server runtime. Development checkouts can use an installed `codex` executable or `OPENAUTHOR_CODEX_BIN`.
- `openauthor auth login --provider openai-codex` asks app-server to run the official browser sign-in. openAuthor never reads, refreshes, or sends the OAuth tokens itself.
- Browser sign-in waits for Codex's account update after OAuth completes, avoiding a false disconnected state while app-server finishes persisting the account.
- Codex keeps this login under `~/.openauthor/codex` by default, isolated from the normal Codex CLI login. Override only for development with `OPENAUTHOR_CODEX_HOME`.
- New ChatGPT-backed conversations use Codex's runtime-recommended model by default. An explicitly selected model is still honored.
- AI use follows the signed-in ChatGPT plan's Codex limits. It does not create OpenAI API usage charges, so openAuthor records estimated API cost as `$0` while retaining token provenance.
- Subscription turns are ephemeral and read-only. Shell execution, web search, apps, hooks, remote plugins, environments, and subagents are disabled; only openAuthor's explicit host tools are exposed.
- The public remote WebSocket transport for app-server is still experimental. openAuthor therefore runs the bundled server locally instead of exposing an unauthenticated or unsupported cloud endpoint.

