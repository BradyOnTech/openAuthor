# Reviewed hosted account deletion

The hosted account lifecycle starts from an author review. It freezes a durable,
exactly versioned account inventory, drains separately approved project deletion
jobs, removes access to retained shared history, and permits Auth deletion only
after independent verification. Local book files are outside this hosted account
lifecycle.

## Author review and durable intent

`mobile_account_deletion_preflight(p_requesting_device_id)` requires the current
live Auth session and its active owned device. It creates no job. The server builds
`schema_version: 1`, an exact `inventory`, and its `inventory_sha256` from current
workspace roles/members, project metadata and existing deletion jobs, device/key
versions, project enrollments/envelopes/snapshot identifiers, own pending outbox
identifiers, and Storage metadata paths. It returns no plaintext, public-key bytes,
sealed keys, manifest bytes, or outbox ciphertext.

`mobile_begin_account_deletion` takes the device, reviewed inventory hash, exact
workspace/project dispositions, and an explicit retained-history acknowledgment.
Every current inventory workspace and project requires exactly one disposition.
An exclusively occupied owned workspace requires `delete` and its projects
require `delete`. Shared or non-owned workspaces require `leave`; their projects
require `retain`, unless a separate project deletion was already approved. A last
shared owner must first hand ownership to another live owner. Retained projects
require an explicit acknowledgment that shared contributions remain, plus an
individual `outbox: preserve | remove` choice for the departing author's pending
encrypted operations. Other authors' operations are never removed by that choice.
For whole-project deletion either outbox value is accepted; whole-project deletion
removes all hosted project data after its verification gate.

`inventory.existing_project_jobs` is a separate list of prior approved jobs,
including jobs whose project metadata was already finalized. These receipts need
no second project disposition and are automatically attached as dependencies.
Their historical `workspace_id` can be null. Current projects with a prior job
also expose `project_deletion_job`; presentations should avoid duplicate rows.

Begin rechecks the exact server inventory under account, sorted workspace, and
sorted project fences. A changed inventory refuses with `40001`, requiring a new
review. An accepted request immediately closes ordinary account authority,
revokes all account devices/enrollments/keys, retires shared project keys known
to its active devices, archives projects selected for deletion, and creates or
links durable child jobs. There is no cancellation or inferred shared deletion.
Closed account and deleted workspace UUIDs cannot be reused.

`mobile_get_account_deletion(p_job_id default null)` requires an owned live Auth
session, but deliberately requires no active device. It therefore reports an
accepted request after its device is revoked. It exposes job phases and per-project
handoff, key-rotation, and backend-verification blockers without lease tokens.
Exact begin replay may reconcile the original request after revocation; clients
must not automatically retry an uncertain destructive submission.

## Worker and verifier boundaries

The Storage scheduler discovers unfinished account jobs with the bounded private
`mobile_list_account_deletion_work(after_job_id, limit)` RPC. Its service-only
`mobile_get_account_deletion_worker(job_id)` supplies content-free routing and
progress. `gateway/src/accountDeletionMain.ts --job <job UUID>` drains one approved
pending child project through the existing leased Storage worker, including
unreferenced object paths inside that project's immutable namespace. Repeated
invocations advance other children; awaiting-verification children are not
claimed again. The worker does not create author intent, alter retention choices,
manufacture cleanup receipts, or call Auth.

The existing project runbook, `docs/encrypted-project-deletion.md`, specifies each
independent backing-object and failed-upload-queue verification. The separate
`mobile_deletion_verifier` role invokes `mobile_finalize_project_deletion` only
after that evidence exists. Service-role Storage credentials cannot invoke the
project or account verifier RPCs. Every child must hold its finalized backend
verification digest before account preparation.

For retained encrypted projects, the remaining owner uses the existing atomic key
rotation/envelope workflow. A merely retired key or changed metadata cannot satisfy
the gate: an active key version greater than the exact reviewed prior maximum is
required. Shared ownership and rotation are rechecked at preparation and in the
Auth transaction. If a retained project is independently removed or moved during
this process, its reviewed retention prerequisites no longer match; account
finalization refuses. Such changed retained scope requires operator review and an
extension to the disposition workflow, rather than inferred deletion consent.

After project verification and any shared handoff/rotation, the independent
verifier calls
`mobile_prepare_account_auth_finalization(job_id, reviewed_inventory_sha256,
cleanup_verification_sha256)`. The cleanup digest identifies the separately held
operator evidence for account access, backing/queue cleanup, orphan attribution,
and retention. SQL checks scope and child receipts, removes own recipient
envelopes, acknowledgments, device public keys/session bindings, membership and
user state, applies reviewed own-outbox removal, and removes empty solo workspaces.
The result is `auth_ready`; Auth still exists.

An explicitly invoked trusted command
`--finalize-auth <job UUID> --reviewed-inventory <reviewed SHA-256>` uses separately
configured `SUPABASE_ACCOUNT_AUTH_SERVICE_KEY`; routine Storage work uses
`SUPABASE_DELETION_SERVICE_KEY`. The command sends one hard Auth admin deletion,
then reads the authoritative durable receipt. The Auth database trigger refuses
premature deletion, rechecks shared prerequisites, and marks the account job
`finalized` in the same transaction. A lost HTTP reply counts as success only if
the exact job/user/hash has a positive finalized receipt. An unconfirmed outcome
is reported without a second DELETE.

## Retained provenance and acceptance limits

Shared ciphertext contains original device identifiers in its AAD and payload.
Rewriting those identifiers would break decryption or erase immutable attribution.
The lifecycle instead preserves only inactive, authorless device/enrollment UUID
rows needed by shared historical foreign keys. It removes their account identity,
public-key records/current-key pointer, session binding and identifying label;
shared project/activity creator attribution becomes null on Auth deletion. Other
authors' key envelopes and immutable snapshots/outbox operations remain unchanged.
The final durable receipt drops inventory names/device labels and project names;
it retains the closed account UUID, reviewed digest, explicit routing choices and
verification digests as the tombstone.

The local controls use synthetic accounts and Storage metadata in a disposable
Unix-socket PostgreSQL cluster. Loopback HTTP exercises the production worker,
RPC/Storage adapters, and hard Auth endpoint shape. It has no physical backing
store, upload cleanup queue, deployed Auth service, provider traffic, or private
book. Fixture operator digests deliberately simulate attestation; metadata
emptiness alone never certifies backing purge.

An orphan project subtree is covered when its permanent project/deletion receipt
can be attributed to the reviewed account. An entirely unknown namespace with no
project or durable receipt is not assigned to an author by guess. Operator evidence
must resolve deployment-specific Storage ownership, orphan objects, queue failures,
and any retention outside these tables before attesting account cleanup. Deployed
worker scheduling, verifier credentials, real Storage/queue receipts and target
Auth behavior remain deployment acceptance, not results of this local fixture.

The current device's existing sign-out cleanup clears local companion keys,
caches and pending work. Hosted revocation cannot remotely erase an offline
device's decrypted cache or shorten a previously issued signed URL's lifetime;
local cleanup, signed-URL expiry, and existing privacy/export notices remain
necessary. This workflow does not call external account operations during tests.

Reproduce the focused checks:

```sh
python3 scripts/verify_account_deletion.py --pg-bin /opt/homebrew/opt/postgresql@17/bin
cd gateway
npm run typecheck
npm run build
```
