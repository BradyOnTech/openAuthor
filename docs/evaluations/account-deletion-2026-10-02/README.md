# Hosted account lifecycle local evidence — 2026-10-02

The migration-18 checkpoint passes 39 SQL assertions, four bounded real queued
transaction controls, and ten TypeScript tests, including a production-adapter
loopback HTTP journey against actual PostgreSQL account/project RPCs. Gateway
typecheck and build also pass. The raw combined run is [verification.log.gz](verification.log.gz). This standalone
checkpoint precedes migration 19's voice-finalization guard; the later
[combined run](../cloud-lifecycle-integration-2026-10-02/README.md) verifies all
current migrations together.

The SQL journey includes pure preflight, exact/stale/duplicate review refusal,
solo projects without device enrollment, immutable begin replay after revocation,
owned status without active device, account namespace/authority freeze, independent
child/backend and account gates, Auth-finalization receipt, tombstone UUID reuse
refusal, shared owner handoff, retained-history acknowledgment, real remaining
author atomic key rotation, paired preserve/remove outbox choices, unchanged
original shared snapshot/outbox metadata, other author's retained ciphertext,
authorless historical identifiers, cross-author status refusal, and a rotation
prerequisite changed after `auth_ready` being refused by the Auth transaction.

The queued controls observe actual `pg_stat_activity` lock waits: a held author
contribution commits before a stale reviewed request (request refuses with no
intent); a held intent refuses elevated reverse-order writes while ordinary
device authority waits then refuses; an old repeatable-read snapshot cannot
bypass freeze; competing shared owners cannot both close and orphan a workspace.
Row triggers use nonblocking account/workspace fences to avoid waiting in reverse
order while holding tuples/project locks.

The HTTP journey drains two account children and 142 own-project Storage paths,
including a Unicode orphan directory and more than one paginated/batched request.
It leaves an adjacent author's project/object untouched, stops at both project
verification boundaries, refuses premature Auth, then deliberately simulates
independent operator receipts. The single Auth DELETE commits in PostgreSQL but
loses its HTTP reply; production reconciliation succeeds through the finalized
receipt, and a later invocation issues no second DELETE. Discovery no longer
returns the finalized job. Unit controls cover malformed/changed state, local
parallel work, bounded discovery, transport deadlines, unsafe destination/error
redaction, exact Auth endpoint/body and separate finalization configuration.

Earlier local red results were test-harness issues: unsupported TypeScript
parameter properties were corrected for the repository's strip-only runtime;
the HTTP batching fixture was increased beyond the existing batch size; the
stale-snapshot probe stopped selecting private job tables. Direct authenticated
registry reads exposed the preexisting recursive `workspace_members` RLS policy;
root owns its separate migration/tests. The stale snapshot is explicitly
established as synthetic fixture DBA before switching to author for the RPC.

These results prove local lifecycle controls, not deployed backing purge or
provider/Auth acceptance. `docs/account-deletion.md` records the operator gates,
unknown orphan attribution, retained-project scope-change refusal, shared
provenance retention, local/offline cache and signed-URL limits. No deployment,
real account, real Storage object, provider, or private author data was changed.
