# Voice allocation crash recovery

Status: implemented and verified against retained sources, disposable fsynced
PostgreSQL and synthetic loopback HTTP. This packet does not establish deployed
PostgREST credential acceptance, live provider termination, usage accounting or
an unconditional expiry guarantee.

## Result and contract

The gateway already validated the provider Location and fsynced its private call
journal before consuming SDP. A crash between that journal write and SQL
attachment nevertheless refused startup recovery because SQL still had a null
call ID. Startup now validates the exact journal lease/call ID and credential
binding, accepts a null SQL call ID only from a non-redacted `allocating` or
`unknown` intent, closes that intent first, attaches the journal's exact ID, and
waits for independently confirmed closure. It cannot register or resume that
recovered call, release SDP, invent a call ID, clear an unresolved journal, or
replace a different existing binding.

Managed provider creation now uses the lease UUID as `X-Client-Request-Id`.
Independent control persists that UUID before network submission, so an intent
with no delivered provider headers still has its exact support correlation ID.
The public gateway request/audit ID remains separate. This header supplies
correlation; this implementation does not infer deduplication or recovery.

## Evidence

| Retained replay | Result |
| --- | --- |
| Fixed baseline `2ed7f6d` plus current regression cases | 25/29 focused controls and 6/9 PostgreSQL cases pass; four and three expected failures, zero skips |
| Final archived source | 29/29 focused controls, 9/9 PostgreSQL cases, zero skips; TypeScript and production gateway build pass |
| Input stability | All 59 archived implementation/test/dependency/SQL inputs match before and after each replay |

The new PostgreSQL controls kill an owned synthetic gateway immediately after
journal fsync and before SQL attachment, while the provider has flushed Location
but withheld its SDP body. They cover both original `allocating` and previously
`unknown` intents, preserve identity/session/hard deadline, require exactly the
original provider call, and retire the journal only after the independent
controller records accepted hangup. Lost hangup acknowledgement keeps the
journal and closing intent and blocks fresh issuance. Lost creation headers keep
an unknown intent with its persisted request UUID; no blind retry or invented
hangup occurs. Existing guarded Auth deletion, redacted exact closed receipts,
credential/role refusal, outage and independently supervised crash controls also
remain exercised.

Strict gateway control-interface cases reject invalid call IDs, missing or
foreign rows, wrong credential binding, malformed/redacted shapes, conflicting
IDs, unsupported null-ID phases, changed user/session/deadline attestation and
an active attachment response. No author bearer, provider key, SDP, instructions
or transcript enters the durable journals.

An initial archived final replay passed all three new PostgreSQL controls but
failed the existing outage test's subsequent issuance wait. That test observed
the recovered closed receipt before waiting for the live successor's successful
poll/heartbeat. It now waits for that actual `TICK` before attempting fresh
issuance. The original failed trace and its exact 59 inputs are retained as
`readiness-order-failure.raw.gz` and `failed-final-inputs.tar.gz`; no production
readiness gate or timeout was relaxed. This synchronization explanation is an
inference from the test's ordering; the failure log did not expose the gateway's
private refusal reason.

## Replay

Use the repository's already installed gateway dependencies. The evaluator does
not download or install packages and uses only synthetic credentials:

```sh
python3 docs/evaluations/voice-allocation-recovery-2026-10-02/evaluate.py \
  --pg-bin /opt/homebrew/opt/postgresql@17/bin \
  --node-modules ~/Developer/openAuthor/gateway/node_modules \
  --mode final
```

`--mode baseline` overlays the two exact retained source files from the fixed
baseline onto the current regression cases and requires the expected failing
counts. Both modes extract the archived inputs into a temporary directory,
verify fingerprints, run actual gateway/control interfaces, and verify the
inputs again. The PostgreSQL runner starts and stops only its own socket-only
disposable cluster; SIGKILL targets only fixture children. The narrow-role HTTP
fixture exercises actual SQL but does not verify deployed JWT signatures.

## Remaining provider boundary and sources

If the provider allocated a call but no valid Location reached the gateway, or
the gateway died before the known ID became durable, this change cannot discover
that ID. Lost hangup acceptance before a durable receipt can likewise remain
unconfirmed. Unknown allocation still blocks fresh issuance and account
finalization. An operator needs recovered original durable state or positive
provider/support evidence; a timeout, 404, elapsed deadline or empty controller
scan is insufficient.

Official OpenAI documentation was searched and fetched on 2026-10-02. The
[Realtime create reference](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/create)
documents a multipart SDP/session request. The
[server control guide](https://developers.openai.com/api/docs/guides/voice-server-controls?voice-api=realtime)
supplies the call ID through Location and requires that ID for sideband control.
The inspected [calls index](https://developers.openai.com/api/reference/resources/realtime/subresources/calls)
lists create, accept, hangup, refer and reject; no list/retrieve or request-ID
lookup was documented. This is a limitation of the inspected public contract,
not proof that an internal provider capability cannot exist.

The [request-ID guidance](https://developers.openai.com/api/reference/overview#debugging-requests)
describes support correlation for supported endpoints, including timeouts when
no server request ID was received. It does not explicitly establish Realtime
support retention, an idempotency contract, or a request-ID-to-call recovery API.
The [hangup reference](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup)
requires a known call ID. Sideband/SIP examples do not provide a WebRTC allocation
lookup when that ID is unknown. No authenticated API calls, provider calls,
deployment, real account changes or credentials were used for this packet.
