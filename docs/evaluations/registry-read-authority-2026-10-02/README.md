# Registry read authority

The pre-repair registry policies query `workspace_members` from that table's
own SELECT policy. Actual authenticated reads of workspaces, memberships,
books and activity raise PostgreSQL `42P17`. An ended Auth session also retains
access to its own `workspace_user_state` under the original owner-only policy.

Migration `20261002200000_registry_read_authority.sql` uses one nonrecursive
SECURITY DEFINER predicate for the current `auth.uid()` and its live, unfrozen
Auth session. It accepts only a workspace UUID. The existing arbitrary-user
role helper remains an invoker function. Registry reads preserve all three
membership roles. Own workspace-state reads and changes also require current
membership and live authority. No table privileges or membership roles change.

`baseline-red.txt` records the actual baseline failures through migration19.
`current-green.txt` records **85 passing assertions** after migration20,
including a real reviewed account-deletion request that freezes an account
while preserving the remaining members' reads. Every applied migration and
executed SQL input has a recorded SHA-256. `results.json` contains the control
names and scope; `source-and-evidence.tar.gz` retains exact replay inputs.

Replay from the repository root:

```sh
python3 docs/evaluations/registry-read-authority-2026-10-02/evaluate.py --baseline --migration-through 20261002190000_mobile_voice_control.sql
python3 docs/evaluations/registry-read-authority-2026-10-02/evaluate.py
```

The runner creates and removes a private PostgreSQL17.11 cluster with fsync
enabled and a temporary Unix-domain socket. Test-only table grants model the
configured Supabase API privileges and roll back with all synthetic records.
This is local SQL authorization evidence. No existing database, deployed
account, provider call, or physical Storage backend was changed or certified.
