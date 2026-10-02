# Ongoing voice access: local engineering assessment

This is an assistant engineering assessment of synthetic local fixtures on October 2, 2026. It is not deployed-service, physical-phone, author, final billing, or signed-release acceptance. No live provider calls, deployment changes, real credentials, or private author data were used.

## Implemented behavior

The production gateway now owns a short renewable lease and an immutable hard call deadline. Its default bounds are a 30-second lease, a 10-minute maximum duration, current-authority polling every 5 seconds, and independently bounded verification/control requests. The lease deadline is also limited by the current signed JWT expiry. A refreshed JWT must retain the same signed user, tenant, device and Auth session; project/device changes cannot adopt an existing call. Renewal never extends the hard deadline or consumes another issuance quota slot.

The issuance response carries `lease_id`, `call_id`, `expires_at`, `lease_expires_at`, and `renew_after_ms`. Authenticated `/v1/realtime/sessions/{lease_id}/renew` and `/stop` routes require the owned project/device scope. The renewal hint is capped at 10000 ms even when the deployment selects the allowed 120-second short lease. The gateway does not accept a client call ID as termination authority.

The existing Boolean Supabase authorizer supplies current authority. The required active-authority migration verifies the actual live `auth.sessions` row, matching user/session/device, current workspace membership, active project, current device key and unrevoked enrollment. Gateway polling and renewal fail closed when verification or hosted authorization is unavailable. The shared issuance quota remains database-owned; the new lease controls supplement it.

The upstream adapter validates the provider's exact same-origin call `Location`, durably registers that identity through the manager before reading/delivering SDP, and uses the server API key for hangup. Managed failures have one cleanup owner: `SessionLeases`. Pending late creation remains in the global issuance gate until it settles, and unknown teardown retains the journal and blocks new issuance. A late response cannot silently detach its cleanup from that gate.

`CallJournal` contains only opaque lease IDs and validated call IDs. It uses exclusive process ownership, 0600 files in a gateway-owned 0700 POSIX directory, atomic rename, file fsync and directory fsync. It stores no JWT, SDP, manuscript, user/project identity, or API key. Startup acknowledges teardown of every previous known call before becoming ready; it does not restore sessions whose bearer authority cannot be revalidated.

The local `createSessionGateway` utility still permits issuance-only fixtures without a lease manager. The production entrypoint requires a persistent journal and initialized monitor; it has no production opt-out. Deployment requirements and the exact wire are documented in [the gateway README](../../../gateway/README.md).

## Verification and independent review

The final command was:

```sh
python3 scripts/verify_shared_gateway_limiter.py --pg-bin /opt/homebrew/opt/postgresql@17/bin
```

[The final raw result](postgres-gateway-checks.txt) records a disposable PostgreSQL cluster, the existing encrypted-sync authorization suite, the live Auth-session/workspace/project/key authority SQL checks, all **50 gateway tests passing with zero skips**, TypeScript checking, and the emitted gateway build. The real database/HTTP quota integration runs rather than taking its ordinary opt-in skip. It exercises the actual gateway adapters against a synthetic local RPC HTTP surface backed by real PostgreSQL, not a deployed PostgREST/Auth/Storage stack.

The 14 lease-manager controls use the actual OpenAI HTTP adapter against a loopback provider fixture, real private journals, and actual subprocess termination. They cover autonomous short expiry, JWT expiry, immutable duration despite renewal, denied and hung authorization, signed-session and project ownership, concurrent renew/stop, failed hangup retention/retry, late creation/global refusal, configured renewal hints, startup refusal, and the public issuance/renew/stop HTTP routes. The crash case sends `SIGKILL` after the call ID is fsynced while the SDP body is withheld, then requires startup hangup before readiness. Provider fixtures return 404 for an already-closed call, so a duplicate hangup cannot masquerade as acknowledged teardown.

[The managed-cleanup red result](managed-cleanup-red.txt) reproduced the competing cleanup owners: a first manager hangup failed, the adapter's extra hangup succeeded, and the manager subsequently received 404 and could never retire the record. The final public-adapter control forces that same failure/success sequence and now observes exactly two owned hangup requests and an empty journal. [The late-creation red result](late-creation-red.txt) is explicitly an isolated regression variant with the pending-creation retention guard removed; it demonstrates new calls escaping the global gate. It does not describe the final source.

[An initial full-run timing failure](postgres-gateway-timing-red.txt) came from the routine fixture's 80 ms control timeout during concurrent cold HTTP startup. Routine test deadlines were widened; the intentional late-response controls retain an 80 ms manager timeout against 200 ms delayed headers. The final full run above passed. Earlier intermediate `gateway-checks.txt` and `lease-manager-checks.txt` logs are retained as history; the final 50-test PostgreSQL-backed result is the checkpoint authority.

The mobile owner independently reviewed the final managed-callback and raw-settlement cleanup delta and reran all 14 manager plus 7 upstream controls: **21/21 passed, zero skips**. The assessment found no material remaining defect in that delta. A reciprocal read-only review of the mobile lease parser, policy session, controller, hosted auth epoch and App context retirement found no material defect; its separate mobile evidence records its own test/browser scope. This assessment does not convert those browser fixtures into physical-device proof.

`verification.json` pins the current source/test hashes, required SQL migrations, fixture runner, final log and runtime versions. The committed SQL checkpoint and the uncommitted gateway source are distinguished there; no source commit, publication, or deployment was performed by this lane.

## Documented deployment and upstream limits

- Each live replica needs its own private persistent POSIX journal and sticky renewal/stop routing. A wrong-replica control fails closed while the owning live process expires its lease. Shared active lease ownership across replicas is not implemented.
- Timers enforce access while the owning process runs. Host/process outages suspend those timers until restart cleanup; strict wall-clock enforcement through outages requires an independently live watchdog/shared call-control deployment.
- A crash or lost creation response before a call ID reaches the gateway leaves an unknown provider allocation that this journal cannot map or terminate. No SDP answer is delivered in that window, but allocation/usage is unknown. Complete call-creation crash containment is not established.
- The journal does not bind an API project/key. Production fixes the upstream origin to OpenAI. Drain known calls before credential/project rotation. A changed project/key, 404, transport loss, or other unacknowledged hangup retains unknown cleanup and requires operator review; it is not silently treated as successful closure.
- OpenAI hangup 200 acknowledges that teardown starts, not that final media or final usage has been observed. A sideband connection is supported upstream but is not implemented here to observe final usage or prevent all client session-policy changes. Monetary spend controls and final billing accounting remain separate work.
- Real deployed GoTrue session behavior, PostgREST wire integration, Storage, sticky routing/persistent-volume operations, provider call controls and physical-phone media behavior still require deployment/device acceptance. These fixtures certify the described local implementation only.

## Primary API sources

The official [Realtime hangup reference](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup) defines authenticated `POST /v1/realtime/calls/{call_id}/hangup`. The official [SIP/WebRTC call-control guide](https://developers.openai.com/api/docs/guides/voice-sip?voice-api=realtime) describes hangup acknowledgement as beginning teardown. The official [server-controls guide](https://developers.openai.com/api/docs/guides/voice-server-controls?voice-api=realtime) describes obtaining the call ID from `Location` and the authenticated `wss://api.openai.com/v1/realtime?call_id=...` sideband interface. The implementation uses the documented hangup seam; it does not infer an undocumented 404-success guarantee.
