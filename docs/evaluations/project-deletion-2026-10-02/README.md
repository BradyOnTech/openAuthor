# Encrypted project deletion: local evidence

This is an assistant engineering assessment of synthetic local fixtures on
October 2, 2026. It is not author acceptance, a deployed-service certificate or
proof of physical backing-object purge. No real provider calls, deployed writes,
real credentials or private author data were used. This lane performed no commits.

The implemented worker enumerates the exact frozen project subtree, including
orphan uploads outside the published manifest. It prepares a durable exact batch
before HTTP deletion, reconciles lost/partial replies with fresh readback, and
requires the database's independent pending-path absence check before clearing
intent. Its terminal success is `awaiting_backend_verification`. The separate
worker credential cannot submit an accepted backing attestation or finalize
metadata. See the [execution runbook](../../encrypted-project-deletion.md) and
`results.json` for source hashes, scope and the final checkpoint.

## Verification

The final command was:

```sh
python3 scripts/verify_shared_gateway_limiter.py --pg-bin /opt/homebrew/opt/postgresql@17/bin
```

The root-captured final result at `/tmp/openauthor-deletion-final-pg.txt` passes the
existing encrypted-sync and live-authority SQL suites, the new recovery/deletion
SQL suites, **eight real PostgreSQL concurrency controls**, and **66/66 gateway
tests with zero skips**, TypeScript checking and build. The root owns the durable
raw/compressed and whitespace-normalized log capture and its evidence hashes.
The capture names/hashes in `results.json` are finalized by that owner; earlier
intermediate logs are not the authority for this final checkpoint.

The 15 focused worker controls exercise actual loopback HTTP adapters, a private
fsynced prepared-job fixture, real subprocesses and the executable worker command.
Coverage includes recursive orphan folders, more than one listing page, adjacent
book retention, unsafe/duplicate/foreign metadata, partial deletion, lost DELETE
reply, unavailable readback, superseded leases, acknowledgement failure,
inventory bounds, request deadlines, secret-safe failures, SQL-compatible UUIDs
and lease durations. Two subprocess controls send actual SIGKILL: one after
durable batch preparation while its RPC reply is withheld, and one after the
Storage metadata deletion commits while its reply is withheld. Both resume the
same persisted batch; the latter resumes without another destructive request.

The PostgreSQL-backed worker control creates distinct synthetic users, a real
Auth-session row, owner/device enrollment and v7 project UUIDs. It begins owner
deletion through the actual SQL RPCs, then removes the original Auth session.
The trusted HTTP JobStore adapter executes only whitelisted RPCs with the exact
parameter names as `service_role`; the current durable approved intent remains
usable. Real Storage metadata is listed recursively through a loopback HTTP
surface, then removed in three-path batches. Pagination, Unicode/spaces and
unpublished orphan keys are included. A lease is replaced after the HTTP delete
commits: the old worker cannot acknowledge it, and its successor clears only the
same durable pending batch after fresh readback. Both jobs remain before backing
verification; project metadata and the adjacent project's object are retained.
Actual PostgreSQL privileges deny `service_role` finalization.

The Storage fixture DELETEs `storage.objects` solely to model a successful
Storage HTTP metadata effect. It has no S3/filesystem backing objects or
failed-upload queue. It therefore proves adapter/lease/database coordination,
not physical ciphertext removal or deployed PostgREST/Storage behavior.

The independent mobile agent read the final bounded worker/CLI design and found
no material defect. That review confirmed exact pending intent, current-lease
checks, target-only HTTP deletion and the separate verifier boundary. The root
and peer separately reviewed the SQL fence and ran its real concurrency tests.

## Retained red and intermediate results

- `worker-interface-red.txt` records the initial missing worker interface. It
  is a missing-module red result, not a reproduction of a deployed deletion bug.
- `worker-http-green.txt` records an intermediate 12-control worker checkpoint.
- `gateway-worker-checks.txt` records an intermediate standalone checkpoint:
  65 discovered, 64 passing and one ordinary PostgreSQL opt-in skip, before the
  new PostgreSQL worker fixture and serial-file test flag were added.
- `initial-pg-fixture-red.txt` records the first 66-test attempt. Its new fixture
  failed before worker execution because its synthetic device public key
  duplicated the quota fixture's unique fingerprint. The fixture now derives a
  distinct deterministic public key from its device-key UUID. The final real-PG
  run above passes.

The production deletion worker and SQL fence are useful local implementations.
The remaining physical-purge gate is intentional: an empty public Storage list
cannot prove old uploads have settled, cleanup queues are drained or backing
versions are gone. The separately authorized verifier records only the SHA-256
digest of an external operational verification record. SQL validates the role,
lease, phase and metadata emptiness; it does not validate that external record's
contents. A target-backend verification procedure, actual Storage deployment
acceptance and multi-project account-deletion orchestration remain open.

The API basis is the official [Storage REST reference](https://supabase.com/docs/reference/self-hosting-storage/search-for-objects-under-a-prefix),
installed official `@supabase/storage-js` 2.112.4 types/wire, current upstream
[object deletion](https://github.com/supabase/storage/blob/master/src/storage/object.ts)
and [uploader completion](https://github.com/supabase/storage/blob/master/src/storage/uploader.ts).
These sources support the implemented HTTP seam and its stated limits. The
selected deployed Storage version/backend has not been pinned or exercised by
this local assessment.
