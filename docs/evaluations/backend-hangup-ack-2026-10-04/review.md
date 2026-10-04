# Backend cancellation acknowledgement and journal retirement

The backend portion of the WebKit aggregate at `845ba09` failed the existing
revocation/expiry case: after the provider fixture removed a call, its journal
still contained one record. Fourteen other backend cases passed. This backend
uses no browser engine; the aggregate browser choice did not cause the failure.

The provider fixture removes its call before ending the hangup HTTP response.
Production `OpenAIRealtimeUpstream.hangupCall` awaits a successful response, and
`SessionLeases` then retires the durable `CallJournal` entry. Observing only the
provider's call set is earlier than that acknowledgement and retirement.
Keeping the recovery record during this interval is the correct behavior.

A controlled response gate reproduces the original premature journal-empty
assertion in all three revocation-first runs and all three expiry-first runs,
with zero retries. Both controls fail the same expected-zero/actual-one journal
assertion. The included patches reconstruct their exact tested source from the
final source; the first control used a resolver initializer subsequently changed
to a definite assignment, which does not alter the response gate's behavior.

The existing case now holds the real HTTP acknowledgement and checks the exact
lease/call record in memory and on disk while it is held. It releases the response
and polls actual journal retirement with the original 1-second/3-second bounds
and 25ms interval, checks the persisted journal is empty, verifies no active call,
one exact hangup, and renewal HTTP 410. Revocation must still occur before lease
expiry. The gate always releases in `finally` before shutdown, even on failure.
No production code, application configuration, retry policy or timeout changes.

The corrected case passed all three repeats, independently exercising revocation
and unrenewed expiry in each repeat. All 15 backend cases then passed through the
strict project wrapper in 36.72 seconds, with zero retries and no skips. The e2e
TypeScript check passed. Raw reports/logs, the original root failure, mutation
patches and source/artifact hashes bind this packet. Full browser aggregates and
fresh CI remain the parent integration checks.
