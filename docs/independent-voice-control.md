# Independent known-call controller

Status: implemented and locally verified with real PostgreSQL, actual loopback
HTTP adapters, child-process SIGKILL and disposable database stop/restart. This
is not a deployment or live provider certificate. The evidence packet is
[independent-voice-control-2026-10-02](evaluations/independent-voice-control-2026-10-02/README.md).

## Safety contract

The public gateway verifies the application JWT, applies current device/project
authority and shared quota, then creates a content-free allocation intent in
PostgreSQL **before** submitting the provider request. Database time sets the
immutable hard deadline, short renewable deadline and last verified JWT cap.
The exact provider Location supplies the call ID. The gateway records it in
its existing private journal and attaches it to the shared intent. An
independent controller claims that row, fsyncs its own bound private journal,
and acknowledges observation in SQL. The gateway withholds the SDP answer
until it reads that exact active/observed record and rechecks application
authority and expiry. An empty controller scan or heartbeat alone cannot
release an answer.

Managed creation sends that already durable lease UUID as `X-Client-Request-Id`.
Startup can now recover an exact call ID fsynced in the gateway journal before
SQL attachment: it first closes the allocating/unknown intent, attaches only
that journaled ID, and requires independent accepted closure. It never resumes
the recovered call or returns its SDP. The
[allocation recovery packet](evaluations/voice-allocation-recovery-2026-10-02/README.md)
records actual pre-attachment SIGKILL controls and the unresolved boundaries.

Renewal preserves the original subject, tenant, project, device, GoTrue session
and provider binding. A database revision CAS admits only one concurrent
renewal. Only short/JWT deadlines can advance, within the original hard limit.
No author bearer, provider key, SDP, tools, context, transcript or prose goes
into the control tables or journals. Active records retain opaque identity
metadata and timestamps. Guarded Auth deletion redacts user, tenant, project,
device and session from closed records. The exact lease/call/binding/deadline
receipt remains available to reconcile crash journals; retaining those receipts
still needs an administrator-owned policy.

Current database authority checks the actual live Auth session, its user and
`not_after`, current workspace membership, active project, active project-device
binding, current device/key and permanent project/account deletion freezes.
It does not manufacture user JWT claims. Worker RPCs operate through narrow
trusted credentials and security-definer functions.

The controller claims rows with a fresh opaque generation and bounded expiry.
Before normal teardown SQL persists `closing`. A private closing intent is also
fsynced before HTTP hangup. Only the current generation can acknowledge SQL
closure. A provider 200 acknowledgement is fsynced locally before completing
the database record. If SQL is unreachable, the private journal permits
fail-closed hangup of exact known IDs; that durable receipt can finish SQL
cleanup after restart. Explicit foreign-generation refusals are not bypassed.
No failed/lost reply or 404 is interpreted as proof of termination.

## Provision and run

1. Apply the repository migrations through
   `20261002190000_mobile_voice_control.sql`, including project/account freezes.
   It creates `mobile_voice_gateway` and `mobile_voice_controller` as narrow
   `NOLOGIN NOINHERIT` roles and grants them only their dedicated RPCs. Existing
   elevated or inherited roles of those names and incoming membership from
   any role except `authenticator` are refused. The authenticator must be
   unprivileged `NOINHERIT`; PostgreSQL 16+ grants explicitly permit `SET`,
   without `INHERIT` or `ADMIN`. Public, anonymous,
   authenticated and service roles have no control-table/RPC capability.
2. An administrator must separately provision trusted PostgREST credentials
   for those roles and verify that the target PostgREST signature/role path
   accepts them. The repository does not mint credentials. Local token
   inspection rejects wrong/broad/expired roles; Supabase remains responsible
   for signature verification. A publishable API key accompanies the narrow
   private bearer. Do not replace it with a broad service-role bearer, put a
   controller credential in the public gateway, or expose either to mobile.
3. Provide the gateway's environment from `gateway/config.example.env` and the
   controller's separate environment from `gateway/controller.config.example.env`.
   Both need the same actual OpenAI key, explicit project ID and optional
   organization ID. Actual create and hangup HTTP requests send those project/
   organization headers. The binding hash includes the fixed official origin
   and a key fingerprint; it is configuration consistency proof, not independent
   validation of provider-account ownership or credential permissions.
4. Provision private persistent controller storage owned by its unprivileged
   process user. Each live replica owns its own journal; never share a journal
   between processes/hosts. The adjacent `.binding` and `.control` files are
   part of its durable state. Corruption, changed hostname or ambiguous PID
   ownership requires review. Do not remove state files to force startup.
5. Build with `cd gateway && npm run build`. Run the independently supervised
   controller using `node dist/voiceControllerMain.js`; run the public gateway
   separately using `node dist/main.js`. An actual independent host/failure
   domain is required to survive gateway-host loss. Replicas use fresh process
   UUIDs and expiring database claims; a replacement drains its private known
   calls before refreshing readiness. Sticky public-gateway routing remains
   required for renewal/stop because those request owners remain in memory.

Defaults are a 1-second controller poll, 15-second claim and 5-second bounded
control request, with a 30-second renewable lease and 10-minute hard maximum.
Registration requires a sufficiently fresh matching heartbeat. Failure or
unknown cleanup blocks fresh allocation. Claim takeover, batching, network
latency and provider teardown add delay; the local tests do not certify an
operational expiry SLO or unconditional wall-clock guarantee. Size and monitor
replicas before accepting production load. `/healthz` is gateway liveness only,
not controller/DB/provider readiness.

Before rollout, drain older journals with the original provider credentials
using explicit `GATEWAY_VOICE_CONTROL_MODE=legacy-recovery`. That mode refuses
new issuance. Independent startup reconciles new local journal entries against
shared control records, including already acknowledged closure; it refuses
missing/mismatched records. Do not discard a legacy entry to bypass unknown
cleanup. For key/project/org rotation, drain all nonclosed records first. A
fresh binding cannot bypass undrained/unknown old calls; the controller refuses
to open a journal bound to different credentials.

## Verification

```sh
python3 scripts/verify_voice_control.py --pg-bin /path/to/postgresql/bin
```

This command creates an fsync-enabled, Unix-socket-only disposable PostgreSQL
cluster; loads actual migrations; runs `supabase/tests/mobile_voice_control.sql`;
and executes `gateway/test/voiceControl.postgres.test.ts`. Synthetic loopback
HTTP routes translate whitelisted RPC JSON into actual narrow-role SQL. The
fixture does not implement deployed PostgREST JWT signature verification or
contact OpenAI. It stops/restarts only that disposable database and SIGKILLs
only its own synthetic gateway/controller children. Gateway tests run serially
because database restart is intentional.

The combined repository verifier also runs these tests with its isolated PG
environment. `cd gateway && npm run check` runs TypeScript/build plus HTTP and
private-journal controls; PG tests are explicitly skipped without the isolated
PG environment. Use the real-PG command for release evidence.

## Remaining boundaries

The documented [Realtime hangup API](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup)
can control a known WebRTC call ID. Its 200 starts teardown; it does not supply
final media, usage or monetary accounting. [Sideband control](https://developers.openai.com/api/docs/guides/voice-server-controls?voice-api=realtime)
could add observation but is not an automatic expiry guarantee and is outside
this implementation. Do not infer closure from disconnecting a sideband socket.

A provider allocation can precede delivery of a valid Location or durable
journaling of that identity. A timeout/crash in that window leaves an unknown intent and
withholds the answer. The inspected [create schema](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/create)
and [calls index](https://developers.openai.com/api/reference/resources/realtime/subresources/calls)
offer no documented request-ID-to-call recovery. Do not blindly retry creation
or clear unknown intents. `X-Client-Request-Id` supports
[support correlation](https://developers.openai.com/api/reference/overview), not
a documented idempotency or recovery API. A crash after hangup acceptance but
before its local receipt is durable can likewise remain unconfirmed.

If all independently live controllers, reachable durable state or the provider
control network fail, strict expiry is not established. The provider's
[60-minute session maximum](https://developers.openai.com/api/docs/guides/realtime-conversations)
does not enforce this application's shorter deadlines. [Client-secret expiry](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create)
limits session creation and does not terminate an established session.

Account intent freezes new/renewed voice and the controller closes known IDs.
Migration19 blocks verified preparation, `auth_ready`/`finalized` transitions
and Auth DELETE while any allocating, registering, active, closing or unknown
intent belongs to that user. The shared account fence prevents allocation and
finalization from racing; row triggers refuse a contended fence instead of
waiting in reversed lock order. Owned account status reports
`provider_cleanup_pending` and an actionable blocker. Unknown allocation needs
external operator reconciliation; there is no author or worker bypass and no
automatic inference from a 404. Once all records are closed, Auth deletion
redacts their personal scope. A strict redacted closed-receipt shape preserves
restart recovery without reintroducing personal identity.

This gate proves accepted known-call hangup receipts, not final media, billing,
provider-held context or physical backend purge. Auth removal must not be
described as proof of those outcomes. See the actual negative migration-role,
uncommitted allocation/Auth DELETE and redacted restart controls in the evidence
packet. The role grant behavior follows the primary
[PostgreSQL GRANT reference](https://www.postgresql.org/docs/17/sql-grant.html)
and [role membership reference](https://www.postgresql.org/docs/17/role-membership.html).

Live provider termination, separately provisioned target-role credentials,
independent-host supervision/failover, measured expiry/queue bounds, credential
rotation acceptance and physical-device behavior remain unobserved. No deployed
writes, live provider calls, real credentials or real account changes were made here.
