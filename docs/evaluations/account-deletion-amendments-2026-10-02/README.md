# Reviewed retention amendments

This local checkpoint repairs an existing account-deletion request when a retained
shared project moves or is independently deleted. The original account inventory,
workspace/project dispositions, outbox choices and destructive child jobs remain
unchanged. Append-only resolutions identify the effective retained workspace or
attach an exact separately approved, independently finalized project receipt.

Review and submission require the deleting author's live Auth session, including
after device revocation and `auth_ready`. The server fingerprints fresh scope,
versions every accepted amendment, records a durable exact receipt, and refuses
unchanged rows, new destruction, foreign projects, stale reviews, invented purge
receipts and unknown absence. A dedicated read-only lookup returns an earlier
amendment's exact receipt even after another amendment supersedes it.

An amendment invalidates prior account cleanup proof and returns the account to
`deleting`; it never reopens account or device authority. Worker/verifier status
`inventory_sha256` is the current effective intent digest. The immutable initial
hash remains `original_inventory_sha256`. Preparation and the Auth transaction
recheck effective retention, original rotation thresholds, positive independent
receipts and the exact current attested digest. Invalidated cleanup digests cannot
be reused. Independent voice closure remains mandatory through migration 19.

The baseline reproduces a moved shared book after `auth_ready`: Auth removal
refuses `55000`, preparation leaves the old receipt in place, and there is no
reviewed recovery interface. Current SQL exercises repair, repeated movement,
superseded receipt lookup, independent deletion, refusal/rollback, privacy,
rotation, unknown absence and surviving corrupt Storage metadata. Real queued
transactions exercise movement, preparation/Auth races, owner removal and Auth
session loss; a separate control refuses stale-snapshot review.

This is disposable PostgreSQL with synthetic identities and operator digests.
It makes no provider, deployed Auth, Storage HTTP or private-book request. Metadata
and simulated digests do not establish physical backing purge. Unknown absent
projects without an exact attested receipt remain unresolved. Deployment,
scheduling, independent backing/queue verification and author/device acceptance
remain separate gates.

`results.json` records exact counts, source fingerprints and retained outputs.
`tested-source.tar.gz` captures both baseline and current inputs. Replay those
inputs without changing the worktree:

```sh
python3 docs/evaluations/account-deletion-amendments-2026-10-02/evaluate.py \
  --pg-bin /opt/homebrew/opt/postgresql@17/bin
```
