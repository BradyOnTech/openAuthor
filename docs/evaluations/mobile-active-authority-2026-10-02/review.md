# Current mobile authority — 2026-10-02

The current database checks now reject a retained device binding when its actual
Auth session has been deleted, belongs to another subject or has passed its
timebox. Removed workspace membership and archived projects also deny ongoing
Realtime authorization. The same live-session and active-project checks protect
encrypted-sync RPCs and the existing Storage policy predicate.

The new `mobile_get_project_key_state` RPC returns the server's latest key version
and its separately nullable active version. Desktop publishing must require the
active version; historical envelopes remain useful for reading old ciphertext
and cannot establish publishing readiness. This RPC requires the signed active
requesting device, a live Auth session, an active book and current editor role.
It exposes no key material. Registration and the Auth token hook also check the
actual session instead of reusing an obsolete binding.

The session shape was checked against the
[official Supabase Auth model](https://github.com/supabase/auth/blob/master/internal/models/sessions.go),
which records a session's user and optional `not_after` timebox. JWT signature,
issuer, audience and token expiry are still gateway/PostgREST responsibilities;
the database adds current stored authority and does not replace those checks.

## Verification

- The retained [red run](red.txt) applies the previous migrations to a disposable
  PostgreSQL 17.11 cluster. The existing encrypted-sync suite passes, then the
  new regression fails because deleting the real Auth-session row leaves
  Realtime authorization true.
- The [green SQL run](green-sql.txt) passes the existing suite and new authority
  suite after applying the migration. Controls include current and expired
  timeboxes, wrong session subject, missing/malformed session claims, membership
  removal/restoration, archive/restoration and preserved viewer voice access.
- The [Storage-policy run](green-sql-storage.txt) additionally installs the
  repository's actual PostgreSQL Storage policies against a minimal metadata
  schema. A live session sees its object's metadata; a deleted session sees no
  rows and cannot insert. These are real PostgreSQL RLS checks, without the
  Supabase Storage HTTP or backing-object implementation.
- Atomic key rotation creates version 1; project-device revocation retires it
  while retaining the historical envelope. The new RPC returns latest 1/active
  null, then latest 2/active 2 after a reviewed rotation. Wrong requesting devices
  and current viewers cannot invoke publishing-key state.
- Internal live-session assertion remains unavailable to clients; the Auth hook
  remains restricted to `supabase_auth_admin`. Existing content relations and
  internal helper permissions retain their restrictions.

Reproduce with `python3 scripts/verify_shared_gateway_limiter.py --pg-bin
/opt/homebrew/opt/postgresql@17/bin --sql-only`. Omitting `--sql-only` also runs
the real gateway HTTP adapter suite against the same disposable database.
No deployed database, account, book or provider was contacted.

## Deletion remains a separate implementation and acceptance gate

The current owner-checked cleanup RPC lists published manifests, which omits
uploaded ciphertext whose publication never committed. A complete lifecycle
must enumerate both published paths and orphan objects, retain a resumable
deletion job, prevent new publication and verify cleanup before removing project
or account metadata. The current change does not claim that lifecycle exists.

The [official Storage uploader](https://github.com/supabase/storage/blob/master/src/storage/uploader.ts)
checks permission before streaming and completes metadata with elevated access.
An upload already in flight can therefore finish after a simple permission
freeze. Completion errors enqueue backing-object cleanup. From that sequence,
I infer that a safe project deletion needs a durable tombstone and a completion
fence, coordinated with finalization; permission policies alone are insufficient.
The normal object listing also cannot certify deletion of bytes awaiting internal
cleanup after failed metadata completion. Testing the chosen Storage version's
cleanup queue and backend is required before claiming physical deletion.

An approved target-deployment migration/drill, physical phones, actual voice and
deletion acceptance remain unobserved. Local checks do not certify those gates.
