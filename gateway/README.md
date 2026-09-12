# OpenAuthor Realtime Session Gateway

This directory contains the self-contained Node/TypeScript service for issuing short-lived WebRTC sessions to authenticated OpenAuthor clients. It accepts a mobile SDP offer, verifies the app principal, authorizes the project/device pair, applies a rate limit, and creates the call through OpenAI's `POST /v1/realtime/calls` endpoint.

The client never receives the permanent OpenAI API key. It receives only the SDP answer, optional call ID, a gateway request ID, and a short connection-establishment deadline.

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
  "call_id": "call_...",
  "expires_at": "2026-08-30T12:01:00.000Z",
  "request_id": "..."
}
```

`expires_at` is the gateway's short connection-establishment deadline, not a reusable credential. Every response uses `Cache-Control: no-store`.

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

`SupabaseJwksPrincipalVerifier` validates asymmetric Supabase access tokens with `jose` and the project's `/.well-known/jwks.json` endpoint. It requires a valid signature, the configured issuer and audience, `sub`, `iat`, `exp`, the `authenticated` role, and the signed `device_id` claim. The verified issuer is the default tenant boundary; deployments may configure a different signed tenant claim. The gateway independently compares the verified device claim with the requested `device_id` before calling the database. Invalid or expired tokens return `401`; JWKS infrastructure failures become content-free server errors.

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
fixed-window limiter, then starts the HTTP server. The server always advertises
tool definitions from `MOBILE_REALTIME_TOOLS`;
`REALTIME_ALLOWED_TOOL_NAMES` may only select a unique subset of those canonical
names.

Copy [`config.example.env`](./config.example.env) into the deployment's secret and
configuration system. These four values are required:

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

For multiple gateway replicas, replace `FixedWindowSessionRateLimiter` through the
`SessionRateLimiter` interface with an atomic shared-store implementation. The
included limiter is bounded and suitable for one process, tests, and initial
deployment.

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
4. Set the returned SDP as the remote answer before `expires_at`.
5. Use the WebRTC data channel for Realtime events; keep tool execution behind the application's authorization layer.

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
