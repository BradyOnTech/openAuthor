# Encrypted project deletion

Deletion begins with an explicit request from a live, enrolled project owner.
`mobile_begin_project_deletion(p_requesting_device_id, p_project_id)` freezes the
project namespace and creates a permanent durable job. The request returns its
opaque `job_id`; it does not return a worker lease or remove project metadata.
The job cannot be cancelled or used to restore, move or reuse the project UUID.
The owner-facing `mobile_get_project_deletion` status RPC omits worker capability
material. An author session or membership disappearing after the approved
request does not erase that durable intent.

Apply `20261002160000_mobile_project_deletion.sql` after the encrypted-sync and
active-authority migrations. This migration requires the actual `storage.objects`
schema. A shared/exclusive project fence and metadata triggers close elevated
upload completion as well as ordinary authorization. Encrypted writes require
READ COMMITTED; stale snapshot transactions cannot bypass a committed tombstone.
The trigger covers INSERT and both the old/new namespaces of UPDATE. It never
removes backing objects from SQL.

## Separate Storage worker

The worker runs in its own trusted process, with these two environment values:

- `SUPABASE_URL`, the selected deployment's origin.
- `SUPABASE_DELETION_SERVICE_KEY`, supplied by the deployment's trusted secret
  system. It must authorize `service_role` RPCs and exact Storage removal. It is
  never sent to a desktop/mobile client or the public voice gateway.

After building the gateway TypeScript, invoke an owner-approved job:

```sh
cd gateway
npm run build
node dist/projectDeletionMain.js --job "$approved_job_id"
```

The command claims the durable job, renews its exact lease generation, and runs
bounded batches. It reports only the job ID, phase, number of acknowledged
metadata paths and run count. A failure prints the content-free
`project_deletion_incomplete` event and exits nonzero. It does not automatically
retry an uncertain destructive call. The job and pending batch remain available
for inspection and a later run after the existing lease expires. The default
lease is 60 seconds; SQL permits 15 through 300. Each network operation has a
5-second deadline, and each invocation permits at most 1000 successful runs.

`ProjectDeletionWorker.runOnce(lease)` is the smaller scheduling seam. One call
handles at most one prepared batch of 100 exact object keys. Every run obtains
fresh authoritative job state and checks the exact job/project/lease token.
It enumerates the entire `projects/{project_id}/` subtree, including orphan
uploads absent from the published manifest. The Storage V1 HTTP adapter handles
relative folder/file names, recursive folders and `limit`/`offset` pagination.
It finishes the bounded inventory before deleting anything, so its own deletion
cannot shift subsequent offsets. Unexpected or duplicate rows, foreign paths,
dot/dotdot segments, unsupported percent/backslash/control characters, excessive
depth or inventory bounds refuse destructive work. These errors keep the frozen
job; they require inspection rather than silent omission.

Before HTTP DELETE, the worker stores an immutable pending batch through the
trusted SQL seam. It deletes exact keys in `mobile-encrypted-sync`, without a
bucket-wide empty/delete operation. Even a successful reply receives fresh
readback. Lost or partial replies retain the same batch; a successor first lists
and reconciles it, then retries only paths still observed. The SQL acknowledgement
independently refuses while any exact pending metadata path remains. This check
also protects against incomplete/shifted pagination caused by an older lease's
already-started DELETE. Neither a filtered author listing nor an empty HTTP page
can clear the pending batch or certify completion.

When no pending batch or unfiltered project Storage metadata remains, SQL moves
the job to `awaiting_backend_verification`. The worker stops. Project metadata,
encrypted manifests, key envelopes and the permanent tombstone are retained.
`acknowledged_paths` counts acknowledged metadata intent; it does not certify
physical ciphertext deletion or identify objects newly removed by that run.

The exact worker RPCs are `mobile_claim_project_deletion`,
`mobile_renew_project_deletion_lease`, `mobile_prepare_project_deletion_batch`,
`mobile_ack_project_deletion_batch`, and
`mobile_mark_project_deletion_storage_empty`. All mutations compare the current
lease generation; batch acknowledgement also compares the exact pending array.
The HTTP adapter's `assertLease` uses that same exact-token renewal RPC. It never
claims a replacement lease implicitly. These RPCs are restricted to
`service_role`; clients cannot read the job table or invoke them.

## Independent backing verification and finalization

An empty Storage listing is a metadata observation. It cannot establish that
previously started uploads have settled, failed-upload cleanup is drained, or
every backing object/version has been removed. Supabase's uploader may stream
bytes before its elevated metadata completion is rejected; cleanup is then
queued. There is no generic public queue-drain API implemented by this worker.
The target Storage version, backend, in-flight uploads and cleanup queue need
an external operational verification procedure and deployment acceptance.

Only a separately authorized database operator can select the nologin
`mobile_deletion_verifier` role. After independently verifying the target backing
state, that operator can call:

```text
mobile_finalize_project_deletion(
  p_job_id,
  p_project_id,
  p_lease_token,
  p_backend_verification_sha256
)
```

The last argument is the lowercase SHA-256 digest of the operator's external
verification record. It is an explicit trusted attestation, not proof that SQL
has inspected the queue or backing bytes. The finalizer checks the current lease,
awaiting-verification phase and unfiltered metadata emptiness under the project
fence, then removes encrypted child/project metadata and retires the lease.
The permanent UUID tombstone survives. `authenticated`, `anon` and `service_role`
cannot invoke this finalizer; the Storage worker cannot manufacture an accepted
receipt with its own credential.

Account deletion must complete the corresponding lifecycle for every owned
encrypted project before account/workspace metadata removal. This project worker
does not automate a multi-project account-deletion orchestration or define a
backend verifier. Those deployment/operator procedures remain explicit work.

## Local evidence and API basis

[The focused evidence](evaluations/project-deletion-2026-10-02/README.md) records
actual loopback HTTP adapters, durable prepared state, real SIGKILL/resume and
the PostgreSQL-backed lease/RPC checks. The fixture's `storage.objects` DELETE
models a successful Storage API metadata effect; it has no backing object store
or cleanup queue. No local result certifies physical purge or a deployed stack.

The official [Storage REST reference](https://supabase.com/docs/reference/self-hosting-storage/search-for-objects-under-a-prefix)
defines paginated prefix listings and exact-path batch deletion. The installed
official `@supabase/storage-js` 2.112.4 source documents relative V1 names and
folder rows. The current upstream [object deletion implementation](https://github.com/supabase/storage/blob/master/src/storage/object.ts)
coordinates backing removal with its metadata transaction; the
[uploader implementation](https://github.com/supabase/storage/blob/master/src/storage/uploader.ts)
performs elevated completion and queues failed-upload cleanup. These inspected
sources inform the adapter and its limits; they do not pin the target deployed
Storage version or establish a physical purge guarantee.
