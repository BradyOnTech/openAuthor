# Reviewed corrections to retained account-deletion scope

An account deletion can remain blocked when a shared book is moved or separately
deleted after the original review. This flow lets the departing author review
that changed evidence while keeping the original destructive intent intact.

## Required behavior

- Preserve the original inventory, workspace dispositions, project actions,
  pending-capture choices, deletion children and permanent namespace tombstones.
  A correction creates no project deletion request and grants no new destructive
  authority. Account freeze and device revocation remain in force.
- Cover only originally retained projects. A moved book can use its exact current
  workspace after a fresh server review, provided another live, unfrozen owner
  remains. Preserve the original key-rotation threshold. Moving a book does not
  establish that rotation happened.
- An absent book requires its exact permanent finalized deletion receipt and a
  positive independent backing-verification digest. Missing metadata, a pending
  job, a wrong-project receipt or unknown absence cannot stand in for deletion.
  This resolution records another owner's independently completed lifecycle.
- Require an owned, live Auth session, including after queued locks. An active
  device is unnecessary because the original request revoked its devices. Reveal
  historical names and stable IDs only; destination member lists, foreign names,
  ciphertext, keys and credentials stay private.
- Bind each correction to a fresh server review digest, the loaded base revision
  and a unique amendment UUID. Review 1–100 selected corrections per submission.
  Preserve an append-only audit and exact receipt.
  A stale or changed review refuses without mutation. Reject no-effect updates.
- Permit a correction in `deleting` or `auth_ready`. An accepted correction returns
  the job to `deleting` and invalidates prior cleanup approval. Fresh independent
  verification must bind the current effective intent. Previously invalidated
  cleanup digests cannot be reused. Existing voice cleanup gates remain required.
- Serialize account, sorted original/effective workspace and project fences with
  project moves, ownership changes, preparation and Auth removal. Recheck actual
  evidence after waits. Reverse-order row triggers must refuse instead of waiting
  while holding conflicting tuples.
- Desktop review starts with no selected corrections. Show old/current scope,
  rotation and ownership prerequisites or the exact finalized deletion receipt.
  Require explicit selection and confirmation. Submit once. Reconcile a lost reply
  through a read-only lookup for the exact amendment UUID, even if a later revision
  superseded it. An old job status alone cannot confirm the correction.
- A definitive PostgREST error response with an allowlisted PostgreSQL rejection
  code establishes a rolled-back submission. Discard that stale review and require
  a new explicit preflight. Transport failures, malformed success/error responses
  and unrecognized error codes remain unresolved; never infer rejection from a
  missing receipt while an outcome is unknown.
- Preserve a pending review across ordinary same-session refocus. Account/session
  replacement and unmount redact it and ignore late results. Do not write hosted
  inventory, names or review fingerprints to browser storage.

## Interface

`mobile_account_deletion_amendment_preflight(p_job_id)` returns the owned job,
phase, `base_revision`, `original_inventory_sha256`, current `intent_sha256`,
server `review_sha256` and an allowlisted list of originally retained projects.
Each project identifies reviewed/effective/current workspace IDs, original
rotation requirements, current active key version, remaining-owner status,
independent deletion evidence, an allowed resolution and blockers.

`mobile_amend_account_deletion(p_job_id, p_amendment_id, p_expected_revision,
p_expected_review_sha256, p_resolutions)` accepts a nonempty list of exact choices:

```text
{ project_id, resolution: "retain_current_scope", workspace_id }
{ project_id, resolution: "attach_finalized_deletion",
  project_job_id, backend_verification_sha256 }
```

Apply returns the exact durable amendment receipt, not account status. Read current
owned progress separately after validating that receipt; a later revision may have
superseded it. If progress readback fails, retain the original amendment UUID and
reconcile through the read-only receipt lookup before another correction.

Current status retains `inventory_sha256` as the fingerprint consumed by the
existing verifier and trusted Auth finalizer. At revision zero it equals the
original inventory hash; after correction it identifies the effective reviewed
intent. Additive `original_inventory_sha256`, `amendment_revision` and
`amendment_receipt` distinguish immutable original review from current state.

`mobile_get_account_deletion_amendment(p_job_id, p_amendment_id)` returns the exact
durable `{ amendment_id, revision, review_sha256, intent_sha256 }` receipt or null.
Clients use this read-only lookup to confirm an uncertain submission, then read
current progress separately. No automatic mutation replay is needed.

## Acceptance evidence

Verification must exercise actual PostgreSQL transactions for retained movement,
independent project finalization, stale reviews, owner removal, competing
corrections, correction versus preparation and correction versus Auth deletion.
Inspect original intent and child records before/after, not just RPC success.
Desktop controls must cover exact wire choices, uncertainty with an unchanged
older job, positive exact receipt lookup, superseded receipts, account/session
changes and reachable laptop controls through the real rendered review.

Disposable SQL and loopback/browser checks establish local behavior. They do not
certify target backing purge, live Auth/provider services, signed Keychain
behavior, offline-copy removal or physical-device acceptance.
