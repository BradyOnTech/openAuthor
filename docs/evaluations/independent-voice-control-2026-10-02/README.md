# Independent known-call voice control — October 2

Implemented and verified locally. This packet is implementation evidence, not
deployed-provider, phone or signed-release acceptance. No live provider call,
deployment, author manuscript, credential provisioning or real account mutation was
used. [results.json](results.json) records exact source and log hashes;
[the runbook](../../independent-voice-control.md) describes provisioning and
remaining operational gates.

The gateway durably records allocation intent before submitting a provider
request. Before delivering the answer it requires the independent worker to
fsync the exact known call ID and acknowledge it in PostgreSQL, then rechecks
current authority and deadline. The worker uses database-time scope/deadline
checks, generation claims, durable closing state and exact-ID provider hangup.
Known calls remain controllable after gateway SIGKILL. Its private cache also
permits teardown while the database is unreachable, without losing the accepted
receipt during worker restart.

| Check | Result | Evidence |
| --- | --- | --- |
| Dedicated fsync-enabled real PostgreSQL, actual migrations and narrow-role HTTP adapters | SQL checks and 6 integrated cases passed; zero skips | [real-postgres-final.txt](real-postgres-final.txt) |
| Final repository-wide disposable PostgreSQL checkpoint | All 8 SQL suites, 16 actual concurrency controls, 94/94 gateway tests, TypeScript and build passed; source hashes unchanged before/after | [combined-current-source-final.txt](combined-current-source-final.txt) |
| Focused private HTTP/parser/journal controls | 12/12 passed | [private-controls-final.txt](private-controls-final.txt) |
| Standalone gateway check | TypeScript/build passed; 85 passed and 9 explicitly optional PG tests skipped without PG environment | [gateway-check-final.txt](gateway-check-final.txt) |
| Canonical version-7 journal compatibility | Red proof retained; repaired focused and real-PG checks passed | [version7-journal-red.txt](version7-journal-red.txt) |
| Closed receipt with fresh former controller claim | 5/6 passed and restart case failed before repair; final 6/6 passed | [closed-old-generation-red.txt](closed-old-generation-red.txt) |

The process fixtures actually kill owned gateway/controller children and stop
and restart their disposable PostgreSQL cluster. They cover SQL renewal CAS,
missing observation, failover, database outage, durable accepted receipts and
lost hangup replies. A lost reply followed by 404 remains unconfirmed and blocks
fresh allocation. Loopback HTTP translates whitelisted RPC JSON to actual SQL;
it does not prove deployed PostgREST signature verification or OpenAI behavior.

The final SQL additionally refuses incoming private-role membership from
`authenticated`, `anon` and `service_role`; safe PostgreSQL17 authenticator
membership is `SET` only. Account-finalization guards reject every unclosed
phase, including unknown allocation, at verified preparation, `auth_ready`,
`finalized` and Auth DELETE. A real uncommitted allocation/Auth DELETE race is
refused. Auth removal redacts closed personal scope while exact positive
lease/call/binding/deadline receipts still retire gateway and controller crash
journals, including a former controller claim that has not yet expired.

Unknown allocation before delivery/durable attachment of the provider call ID
requires operator reconciliation. No documented request-ID recovery API was
found. Complete controller/durable-state/provider-control-network outage still
prevents an unconditional shorter wall-clock expiry guarantee. Hangup200 is
teardown acceptance, not final billing, media, provider context or physical
backing purge proof. Deployment of independent hosts, narrow target credentials,
provider acceptance, measured capacity/latency, credential rotation and physical
device behavior remain open.

Every `.txt` log has a matching `.raw.gz` containing the exact captured output.
Text normalization removes trailing whitespace only; raw and normalized SHA-256
values are recorded separately. Root's final combined run supersedes its earlier
run that applied the migration before the final closed-receipt condition changed.
