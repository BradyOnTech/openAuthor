# OpenAuthor Realtime Session Gateway

This directory contains the self-contained Node/TypeScript service for issuing short-lived WebRTC sessions to authenticated OpenAuthor clients. It accepts a mobile SDP offer, verifies the app principal, authorizes the project/device pair, applies a rate limit, and creates the call through OpenAI's `POST /v1/realtime/calls` endpoint.

The client never receives the permanent OpenAI API key. It receives only the SDP answer, validated call ID, a gateway request ID, and a server-enforced renewable lease and hard duration deadline.

The upstream wire shape follows OpenAI's official [Realtime WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc): multipart `sdp` plus a server-owned `session` JSON object, with the SDP answer returned as the response body. OpenAI's standard API key remains on this trusted server.

## Public HTTP contract

`POST /v1/realtime/sessions`

```json
{
  "project_id": "project-uuid",
  "device_id": "registered-device-uuid",
  "sdp": "v=0\r\n..."
}
```

Required header: `Authorization: Bearer <application-session-token>`.

Browser callers must send an `Origin` that exactly matches `policy.allowedOrigins`. Native mobile clients normally omit `Origin`; absence is deliberately accepted because authentication and project/device authorization remain mandatory. `OPTIONS` preflight is supported for allowed browser origins.

Success is `201`:

```json
{
  "sdp": "v=0\r\n...",
  "call_id": "rtc_...",
  "lease_id": "10000000-0000-4000-8000-000000000001",
  "expires_at": "2026-10-02T12:10:00.000Z",
  "lease_expires_at": "2026-10-02T12:00:30.000Z",
  "renew_after_ms": 10000,
  "request_id": "..."
}
```

`expires_at` is the immutable maximum call duration deadline. `lease_expires_at`
is the earlier of that deadline, the current JWT expiry, and the short renewable
lease deadline. Neither field is an OpenAI credential. Every response uses
`Cache-Control: no-store`.

`POST /v1/realtime/sessions/{lease_id}/renew` accepts
`{"project_id":"...","device_id":"..."}` with a fresh application bearer.
It returns the same lease ID and hard deadline with a renewed short deadline and
`renew_after_ms` hint (at most 10000). A token refresh must preserve the signed
subject, tenant, device and Auth session. A different project, device, tenant,
user or session cannot adopt another call. Renewal never consumes another
issuance quota slot or extends the hard duration.

`POST /v1/realtime/sessions/{lease_id}/stop` accepts the same identity and bearer
and returns `{"stopped":true}` only after upstream teardown is acknowledged.
Unknown/ended leases return 410; scope mismatches 403; uncertain controls 503.
A client call ID is never accepted as termination authority. Offline sign-out
can immediately close local media; the independent gateway lease then expires.

`GET /healthz` is an unauthenticated liveness probe. It returns only
`{"status":"ok"}`, does not access authentication, Supabase, OpenAI, or audit
dependencies, and exposes no configuration or content.

Errors are content-free and structured:

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Too many Realtime session requests.",
    "request_id": "...",
    "retry_after_seconds": 27
  }
}
```

## Supabase identity and authorization contract

`SupabaseJwksPrincipalVerifier` validates asymmetric Supabase access tokens with `jose` and the project's `/.well-known/jwks.json` endpoint. It requires a valid signature, the configured issuer and audience, `sub`, `iat`, `exp`, the `authenticated` role, the signed `device_id` claim, and a valid signed `session_id`. The verified issuer is the default tenant boundary; deployments may configure a different signed tenant claim. The gateway independently compares the verified device claim with the requested `device_id` before calling the database. Invalid or expired tokens return `401`; JWKS infrastructure failures become content-free server errors.

This follows Supabase's official [JWT verification guidance](https://supabase.com/docs/guides/auth/jwts), including asymmetric signing keys and bounded JWKS caching. Configure the device and tenant claims through a trusted access-token issuance flow or Custom Access Token Hook; client-supplied unsigned metadata is not sufficient.

`SupabaseRpcProjectDeviceAuthorizer` calls:

```text
POST {SUPABASE_URL}/rest/v1/rpc/authorize_realtime_session
Authorization: Bearer <the verified user JWT>
apikey: <the Supabase publishable key>

{"p_project_id":"...","p_device_id":"..."}
```

The RPC must return the JSON boolean `true` only when `auth.uid()` is an active member of the project and owns the active, non-revoked device. Define it as a narrowly scoped, `SECURITY INVOKER` function, grant execution to `authenticated`, and keep the underlying tables protected by RLS. The gateway intentionally does not use or accept a Supabase service-role key. `401`, `403`, `false`, malformed responses, and device-claim mismatches fail closed.

## Production process

`src/main.ts` is the executable entrypoint. It parses and bounds the environment,
constructs the Supabase verifier and authorizer, OpenAI Realtime upstream, and
shared Supabase quota adapter and durable session monitor. It acknowledges teardown of every previous journaled call before starting the HTTP server. The server always advertises
tool definitions from `MOBILE_REALTIME_TOOLS`;
`REALTIME_ALLOWED_TOOL_NAMES` may only select a unique subset of those canonical
names.

Copy [`config.example.env`](./config.example.env) into the deployment's secret and
configuration system. These five values are required:

- `GATEWAY_CALL_JOURNAL_PATH`, an absolute path in a private persistent POSIX directory
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `OPENAI_API_KEY`
- `SAFETY_IDENTIFIER_SECRET`, a distinct value containing at least 32 UTF-8 bytes

`SUPABASE_ISSUER` safely defaults to `{SUPABASE_URL}/auth/v1`. Listener, timeout,
body-size, response-size, rate-limit, model, voice, VAD, browser-origin, JWT-claim,
RPC, and tool settings have bounded defaults documented in the example file.
URLs must use HTTPS, browser origins cannot contain paths, and unknown tools are
rejected before the process listens. No service-role key is accepted.

Build and run the emitted JavaScript:

```sh
npm ci
npm run build
npm start
```

Audit events are written as one content-free JSON object per line on standard
output. Audit-sink diagnostics are JSON lines on standard error. Startup failure
prints only `{"event":"gateway_start_failed"}` and exits nonzero; secrets and raw
configuration values are never printed. `SIGTERM` and `SIGINT` stop accepting new
connections, close idle connections, and allow active work to drain until
`GATEWAY_SHUTDOWN_TIMEOUT_MS`. At the deadline, remaining connections are
terminated and the process exits nonzero.

The included multi-stage `Dockerfile` builds TypeScript, prunes development
dependencies, runs as the unprivileged `node` user, and probes `/healthz`. Build it
from this directory with `docker build -t openauthor-session-gateway .`.

Use a separate high-entropy `SAFETY_IDENTIFIER_SECRET`; do not reuse
`OPENAI_API_KEY`. The gateway derives a stable HMAC-SHA256 safety identifier from
tenant and principal identity. Raw account identifiers, JWTs, Supabase response
bodies, and API keys are not forwarded or audited.

Production uses `SupabaseRpcSessionRateLimiter` through `SessionRateLimiter`.
Apply `20261002120000_mobile_realtime_shared_rate_limit.sql` before enabling
Realtime issuance. A user's enrolled devices and books share one atomic quota
across every replica of this Supabase deployment. The RPC verifies the current
device/Auth-session/project binding, owns its clock and serializes quota writes.
It stores only user identity, window start and issuance count; no manuscript,
JWT, SDP or OpenAI credential enters the quota tables.

The administrator-owned `mobile_realtime_rate_policy` defaults to five issuance
attempts per 60000 ms. `GATEWAY_RATE_LIMIT` and `GATEWAY_RATE_WINDOW_MS` assert
that same policy; they cannot override it or reset a user's quota. For an
approved policy change, update that private table using the database's trusted
administrator tooling and deploy matching configuration to every replica.
Authenticated/anonymous clients cannot read or update the tables, and the RPC
accepts no user ID, quota key, clock or policy mutation. Missing migrations,
policy mismatch, timeouts and malformed decisions refuse issuance with a generic
500; there is no automatic retry or local fallback. A lost RPC response may have
consumed a slot, as may a later upstream failure. Ordinary project authorization
runs before quota contact, and the atomic SQL quota checks it again. The current
`/healthz` remains liveness, not a database readiness probe.

The exported `FixedWindowSessionRateLimiter` remains available for standalone
local fixtures. Production never selects it. `GATEWAY_RATE_MAX_KEYS` no longer
configures production; SQL retains one row per user and cascades it on Auth-user
deletion. This quota limits issuance attempts, not concurrent session duration,
continuous Realtime policy, billing or spend. The lease monitor below supplies duration and ongoing access controls; monetary spend and immutable client session-policy enforcement remain separate.

Run the real PostgreSQL/HTTP adapter check in a disposable local cluster:

```sh
python3 ../scripts/verify_shared_gateway_limiter.py --pg-bin /path/to/postgresql/bin
```

It exercises concurrent gateways/devices/books, revoked and stale sessions,
policy mismatch, commit-response loss and actual database restart. It also
reruns the existing encrypted-sync authorization SQL suite and the complete
gateway checks. The separate `shared-gateway-quota` CI job invokes it and retains
the raw result. No deployed stack is contacted; real PostgREST/Auth/Storage
integration still needs deployment QA.

## Active call enforcement and recovery

Production defaults to a 30-second renewable lease, a 10-minute hard duration,
and current-authority checks every 5 seconds. JWT verification and hosted RPCs
have independent bounded timeouts. Revoked devices/keys/sessions, removed
workspace members, archived/deleting books, expired JWTs, denied authority and
unavailable verification cause backend hangup. Apply the active authority
migration `20261002140000_mobile_active_authority.sql` before deployment.
The existing Boolean authorizer must expose current database policy, rather
than a cached authorization decision.

The server uses the documented OpenAI [hangup endpoint](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup)
for WebRTC calls. The call identity comes from an exact same-origin `/v1/realtime/calls/{id}`
Location; redirects, queries and foreign origins are refused. OpenAI 200 means
teardown has begun, rather than evidence that final media/usage events have been
observed. A supported [sideband connection](https://developers.openai.com/api/docs/guides/voice-server-controls?voice-api=realtime)
could additionally observe usage and session updates; this implementation does
not establish immutable client-side session configuration or monetary spend.

`CallJournal` records only opaque lease IDs and validated provider call IDs,
with 0600 files inside a 0700 gateway-owned directory. It contains no bearer token,
SDP, manuscript, project/account identity or OpenAI key. Records are fsynced and
atomically renamed before an answer can be delivered. The manager bounds active
calls, retains uncertain teardown and retries hangup; pending/late creation
remains visible to the issuance gate. Uncertain cleanup refuses new issuance.
Startup stops known old calls instead of restoring unverifiable bearer sessions.

Provision durable storage owned by the unprivileged gateway user. The journal
is local to one replica; each replica needs its own private persistent path and
sticky routing for renewal/stop. A request hitting the wrong replica fails
closed; the owning live replica expires its lease. Do not share a journal
between live processes or hosts. Exclusive ownership refuses an active/unknown
owner. A stale PID on the same host is recoverable automatically. A changed
hostname, PID reuse, incomplete ownership claim or corrupt journal needs
operator review; never discard the call records to bypass startup cleanup.
Production fixes the origin to `https://api.openai.com`; the journal does not
bind an API project/key. Rotate keys within the same project only after old
calls are drained. Changing account/project credentials may prevent cleanup;
non-success hangup, including 404, remains unconfirmed and blocks startup.

This is backend enforcement while the owning process is running, with known-call
cleanup on restart. A host/process outage suspends its timers until restart;
strict wall-clock enforcement across that outage needs an independently live
watchdog/shared call-control deployment. There is also an unavoidable provider
create-to-known-call-ID window: a lost response or crash before Location is
received cannot be durably mapped or terminated by this service. The answer is
not delivered in that window, but provider allocation/usage is unknown. Do not
claim complete call-creation crash containment, final billing accounting or
physical-device acceptance from these local fixtures.

The exported `createSessionGateway` utility supports issuance-only local
fixtures when no lease manager is supplied. The production entrypoint always
requires the persistent journal and initializes its lease manager; there is no
production opt-out.

## Server-owned policy

The client request is never merged into the Realtime session policy. Model, voice, instructions, output modality, transcription model, semantic VAD behavior, tools, tool choice, and safety identifier come only from a validated snapshot of `GatewayPolicy`. Unknown client fields—including a client-provided `session` object—are ignored.

The emitted audio policy enables transcription and `semantic_vad` with automatic response creation and interruption. The explicit `allowedToolNames` list filters `tools`; a configured tool not present in the allowlist is not sent to OpenAI. Keep this list to voice-safe read/propose operations. Mutation approval and execution remain on the trusted application side. OpenAI's [VAD guide](https://developers.openai.com/api/docs/guides/realtime-vad) documents semantic VAD and speech start/stop behavior.

Policy validation fails at startup for inconsistent request/SDP ceilings, invalid timeouts, duplicate or undefined allowlist entries, oversized instructions, or unsafe tool identifiers.

## Privacy and failure behavior

Audit events contain request time, outcome, status, request ID, optional OpenAI request ID, and HMAC hashes for principal/project/device. They cannot contain SDP, project text, authorization tokens, tool arguments/results, raw upstream errors, or the OpenAI API key.

Audit writes are best effort. If the audit sink fails, the gateway emits an optional `audit_write_failed` diagnostic containing only request ID and time, then preserves the intended HTTP result. In particular, a successful OpenAI call is returned instead of being orphaned and retried. Unexpected dependency failures become a generic structured `500`; OpenAI failures become a generic structured `502`.

The upstream adapter uses a JavaScript private field for the permanent key, never logs request/response bodies, discards non-success response bodies, and throws only safe status/request metadata.

## Mobile flow

1. Create an `RTCPeerConnection` and microphone audio track.
2. Create and set the local SDP offer.
3. Send `localDescription.sdp`, the registered device ID, and project ID to this gateway using the app session token.
4. Set the returned SDP as the remote answer before `lease_expires_at`.
5. Renew the owned lease using a fresh token at the bounded hint; stop media on deadline, renewal failure or access/context change.
6. Use the WebRTC data channel for Realtime events; keep tool execution behind the application's authorization layer.

The fake upstream in `src/fakeRealtimeUpstream.ts` exercises this flow without credentials or network access.

## Verification

Requires Node 22.6 or newer. Runtime code uses Node/Web built-ins; TypeScript and Node type declarations are development-only dependencies.

```sh
npm ci
npm run check
```

The tests cover configuration fail-closed behavior, unauthenticated liveness,
graceful signal shutdown, authentication denial, project/device denial, exact
origin handling, request-size enforcement, per-key rate limiting, server policy
clamping, privacy-preserving identifiers/audits, multipart OpenAI request shape,
credential/error non-leakage, audit-sink failure containment, and the mobile SDP
success flow. No live credential is required.
