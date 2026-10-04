# Workspace bootstrap isolation

The original bootstrap treated a globally shared slug as authority to join a
workspace and promoted existing members to owner. The real database baseline
fails the cross-author ownership assertion. Migration 17 scopes new slugs to the
verified author, preserves existing memberships and roles, and refuses a scoped
collision owned by someone else.

The repaired SQL controls pass 13 assertions. Four actual PostgreSQL controls
also pass: simultaneous same-author bootstrap, different-author isolation,
Auth-session removal during an observed advisory-lock wait, and refusal of a
stale repeatable-read transaction. Existing encrypted-sync, live-authority,
recovery and project-deletion suites passed in the same disposable database.

`baseline-red.txt` records a sandbox restriction during PostgreSQL initialization;
it is not the product failure. `baseline-sql-red.txt` records the actual failing
ownership assertion. `current-sql.txt` and `all-sql-current.txt` record the repair.
The latter checkpoint applies through migration 17; later account/voice/registry
lifecycle verification is recorded separately. The SQL display logs remove trailing
whitespace and extra final blank lines; their `.raw.gz` counterparts preserve
original bytes, with both forms hashed in `results.json`.

Reproduce the failing and passing assertion suites using a disposable Unix-socket
PostgreSQL 17 cluster:

```sh
python3 docs/evaluations/registry-bootstrap-2026-10-02/evaluate.py 20261002160000_mobile_project_deletion.sql
python3 docs/evaluations/registry-bootstrap-2026-10-02/evaluate.py 20261002170000_registry_bootstrap.sql
python3 scripts/verify_shared_gateway_limiter.py --pg-bin /opt/homebrew/opt/postgresql@17/bin --migration-through 20261002170000_registry_bootstrap.sql --sql-only
```

No existing database or author workspace is used. These controls establish local
database behavior; they do not establish deployment acceptance.
