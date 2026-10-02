# Final gateway cleanup ownership checkpoint

Read-only follow-up on the final managed-callback delta. Mobile production source and tests stayed frozen and their manifest hashes were rechecked unchanged. No provider, deployment, private account/book or physical device was used.

`openAIRealtimeUpstream.ts:95–98` now skips adapter hangup when the supplied `onCallCreated` callback owns the known call. This matches the existing managed body-error path; unmanaged failures still use adapter teardown. `sessionLeases.ts:108–114` now initiates the manager's existing idempotent termination after raw creation settles when an ending call is known and remains in its map. Failure retains the durable record and global issuance refusal; successful owned acknowledgement retires the journal. There is no competing unmanaged hangup that can consume the successful acknowledgement and leave the manager retrying an already-closed call.

The actual local-HTTP regression at `sessionLeases.test.ts:243–251` forces delayed headers, a first hangup 503, a subsequent hangup 200, and 404 for already-closed IDs. It verifies exactly two owned teardown attempts and no remaining call/journal. The remaining manager controls cover authority/expiry/refresh, concurrent/late responses, global refusal during uncertain cleanup, owned HTTP scope and actual SIGKILL/restart. Upstream controls retain validated Location/redirect/response/privacy and failed-hangup behavior.

Command: `cd gateway && node --experimental-strip-types --test test/sessionLeases.test.ts test/openAIRealtimeUpstream.test.ts`.

Result: 21/21 passed, comprising 14 manager and 7 upstream tests, with no skips. Log: `gateway-final-independent.log`. The same 21 checks were repeated after test-only normal fixture timeout widening for concurrent local test load; explicit late-header controls still use 80ms manager/200ms headers. No material finding remains in this limited delta. `verification.json` records final exact read-only source/test hashes and retains the superseded 13-test initial checkpoint separately.

Existing limits remain: hangup 200 starts teardown; it does not prove final media/billing. Owning-process outage and unknown pre-Location allocation require separate operational controls. Deployed service and physical-phone acceptance remain unverified.
