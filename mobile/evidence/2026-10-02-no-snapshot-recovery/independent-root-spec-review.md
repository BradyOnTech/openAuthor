# Independent Spec review of the root lane

Reviewed local changes since fixed baseline `2ed7f6da`, including new untracked
source/tests, against `docs/no-snapshot-key-recovery.md` and the six-priority
readiness requirements. This review excludes my authored mobile implementation.
It is a source/retained-control review; I did not repeat the root's completed
desktop/database/gateway suites.

**No actionable Spec findings remain in the reviewed root lane.**

The shared DTO/parser enforces exact canonical fields, SQL-bounded version,
12-byte nonce, 57-byte ciphertext and raw 64-hex digest. Desktop recomputes the
digest, authenticates exact AAD/fixed plaintext using a nonextractable AES key,
and refuses non-null bad witnesses without legacy fallback. Current authority
and original account/device/Auth session fence the guarded self-envelope recovery.
Lost mutation replies use one positive readback matching the complete immutable
envelope identity and bytes, then recheck authority; unresolved receipts stay
locked. Recovery does not publish; the next publication is a separate action.

Migration 22 validates exact witness bytes/digest before delegating atomic
complete-recipient rotation, checks actual resulting version, and returns the
complete witness receipt. Live session, account/project namespaces, current
workspace, device/enrollment and recipient-key authority are rechecked after
waits. Readback permits only the exact active version; legacy null is explicit.
Direct routine-role writes are revoked; the trigger rejects updates and retains
the immutable witness until parent-version cascade. SQL cases and real queued
transaction controls cover no partial state, deletion/session/device/key changes,
competing rotations, held proof reviews and stale isolation refusal. The shared
runner includes migration 22 and its concurrency controls.

Gateway known-ID creation journals before attach/readiness. Unknown attach or
closure retains the journal and blocks new issuance; exact local fallback hangup
does not substitute for independent closure acknowledgement. Startup recovery
fences an unattached allocation closed before attaching its journaled call ID,
and retires it only after positive independent closure. Revised gateway unit and
PostgreSQL controls exercise these ordering and unresolved-outcome paths.

These changes satisfy local recovery/control requirements without clearing the
existing author literary judgment, physical-device/live-provider/deployment,
signed-distribution, clean-machine or native accessibility gates. No production
readiness or universal provider media/billing cleanup conclusion is inferred.
