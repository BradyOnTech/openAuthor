# Companion voice: continuous policy and local lifetime

Only original synthetic fixtures were used. No live provider, deployed backend, private book, device signing or physical microphone was used. Desktop port 4173 was untouched; the mobile browser fixture used 4176.

## Interface and behavior

The gateway owns the upstream call. Issuance now requires `sdp`, `call_id`, UUID `lease_id`, immutable `expires_at`, `lease_expires_at` at or before the hard deadline, and integer `renew_after_ms` from 1 to 10,000. The client refuses missing, malformed or expired policy. Renew and stop use `/v1/realtime/sessions/{lease_id}/{renew|stop}`, fresh scoped bearer credentials and `{project_id,device_id}`. The client never supplies a provider call ID as authority.

`VoicePolicySession` is a media fence around that server-owned lease. It keeps the original hard timer, updates only the short timer, serializes renewal and bounds it to 5 seconds. Refused, unknown, malformed or late renewal closes local media; changed lease/hard expiry cannot revive it. It never automatically reconnects. Owned stop is a bounded, best-effort request, with no retry by the client. Failure explanations distinguish closed local audio from remote closure still governed by the gateway lease.

`HostedRuntime` reserves pending voice before asynchronous auth/media work and synchronously closes pending/active calls for sign-out, account change, downloaded-library selection, opening/refreshing a book, local access lock and backgrounding. Every bearer refresh is fenced by the original access epoch, configuration, user/device/key identity. Explicit End can request owned stop after clearing the active registry; sign-out and downloaded mode increment the epoch first and avoid gateway requests. In-flight work already begun while authorized can finish into the encrypted outbox; its result cannot return to a retired call. No capture, manuscript or reading state is deleted by voice closure.

The App ends voice before author scene-context changes and cleans up on project/scene replacement. The existing context action is available during active/pending voice. Late context, audio enablement, tools and transcripts are ignored after closure. Policy failure is a session error, never an author transcript/capture.

## Diagnosis and public-path proof

Ranked hypotheses: (1) missing controller stopped-state allowed late start/events/tool outputs; (2) runtime teardown relied on UI unmount and missed pending auth/media; (3) issuance expiry was dropped, with no renewal enforcement. Distinguishing probes retained in this directory:

- Before edits, three controller regressions failed with two controls passing: late context/audio after stop, stopped tool/transcript processing, and returned tool output after stop. All five passed after the fence.
- Before adapter edits, all seven malformed/expired lease acceptance regressions failed; two existing controls passed. Strict lease validation made all nine pass.
- An isolated saved HEAD `HostedRuntime` replay, with final lower layers and identical public runtime tests, fails 12 cases and passes 4 controls. This is a baseline replay, not a claim that all runtime tests were authored before the fix. Shared production files were never swapped. The saved baseline and commit/hash are retained.
- The actual App browser action first failed because scene-context change was disabled while voice was active. After the bounded action change, the real App/runtime/controller journey proves active and pending-permission context changes stop media, ignore old events and do not overlap sessions. A renewed 403 retires the UI handle, displays the safe policy explanation and permits only deliberate new starts.

## Final verification

`npm run check` passed TypeScript and 167 tests in 29 files, including 16 actual HostedRuntime public-path controls and 33 focused controller/protocol/transport/lease controls. Hosted browser journey 1/1 passed in 8.1 seconds (15.7 with build), continuing through encrypted storage, cold restart, draft/reading recovery, outbox review and offline sign-out. All-platform Expo export passed for web/iOS/Android. Export is not native device execution. The final runtime edit after the browser/export was indentation only; final full TypeScript/unit checks cover that exact file hash.

The initial independent gateway checkpoint passed 13 local real-HTTP/SIGKILL controls. The final managed-callback cleanup ownership delta was then independently reviewed and all 21 affected checks passed (14 manager and 7 upstream). See `gateway-final-review.md`; the final read-only hashes supersede the retained initial checkpoint. The reviewed implementation preserves exact principal/session/book/device ownership, JWT-limited short expiry, immutable hard deadline, renewed/current authority, bounded failures, durable call registration before answer delivery, pending/late creation visibility, global issuance refusal during uncertain cleanup and startup teardown. No additional confirmed material defect was found. Mobile and gateway owners reciprocally reviewed the client seam without edits. `verification.json` records exact sources, hashes, commands and logs.

## Remaining limits

The client timers are local protection. Server enforcement comes from the gateway's autonomous authority polling and owned upstream hangup, using root's active Auth-session/membership/project SQL checks. Defaults are 30-second short lease, 10-minute hard duration and 5-second authority polling; verification/hangup timeouts and upstream failures add delay. Provider hangup 200 starts teardown; it does not prove final media cessation or usage/billing completion.

The owning gateway must be alive. Its durable journal cleans known calls on restart, but strict wall-clock enforcement through a host/process outage needs an independently live watchdog/shared call-control deployment. A lost response/crash before a known provider Location cannot be durably mapped; no answer is delivered but upstream allocation is unknown. Replica-local journals require private persistent storage and sticky renewal/stop routing; a wrong replica fails closed. Immutable upstream session configuration, monetary spend, deployed migrations/API acceptance and physical phone/audio/background/revocation acceptance remain open. These limits are also documented in `gateway/README.md`.

Broader orphan cleanup and desktop trusted-device workflow are owned by other agents and are outside this client patch.
