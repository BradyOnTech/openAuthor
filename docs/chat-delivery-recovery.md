# Pending chat delivery and fresh context review

A saved question can be retried with its immutable delivery identity or recovered
through **Review current context**. Fresh review first calls the local
`chat.delivery.reconcile` operation. It never contacts a provider.

The operation holds the same conversation and delivery locks as Send. It waits
for an active writer, completes and publishes a durable reply receipt when one
exists, and reports completion without starting another turn. A completed
Assistant turn whose receipt is missing remains blocked; fresh review cannot
duplicate it.

When there is no completed receipt, core durably closes the original request ID.
A delayed send or Retry using that ID is refused. A failed, stopped, or abandoned
running attempt is reported as indeterminate: it may already have reached the
provider and incurred charges. Only the author's explicit Send after a fresh
review starts another attempt.

After successful reconciliation, the desktop journal stores a review draft. It
retains the question, original scene/chapter/character IDs, context options,
Storyline scope, and replacement history boundary. It clears the old delivery and
turn IDs, context fingerprint, and one-time Memory and Canon grants. Preview
reads the current saved manuscript and Storyline. The exact reviewed fingerprint
must still match when the author chooses Send.

The recovered question can be edited in review. Editing clears permissions and
invalidates the preview. Back to message retains the saved question and leaves
the separate composer question and scope pickers unchanged. Restart restores the
review draft and requires permission again. Stop remains available while the
reviewed provider turn runs, through the existing request-specific interruption
operation. An interrupted delivery retains the question for explicit recovery.

Local journal failures prevent a fresh send. If core closed the old identity but
the review draft could not be written, the original identity stays in the local
journal and can be reconciled again. Retrying that closed identity cannot start
a provider call.

The existing regeneration protocol keys its receipt by replacement turn ID;
ordinary sends key it by delivery ID. Reconciliation preserves both identities
instead of migrating or rewriting older receipts. The CLI equivalent is
`chat reconcile --thread ID --request-id ID --turn-id ID --json`.

Evidence is recorded in
[`evaluations/chat-recovery-2026-10-02/verification.json`](evaluations/chat-recovery-2026-10-02/verification.json).
The browser journeys use disposable books and the offline provider. They verify
stale Memory refusal, fresh permissions and fingerprints, cancellation, question
editing, restart, and completed-response loss. They do not certify an external
provider's billing behavior or the native bridge's persistent-process lifecycle.
