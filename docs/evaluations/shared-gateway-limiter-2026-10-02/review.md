# Shared gateway issuance quota — October 2

Production gateway issuance now uses the existing `SessionRateLimiter` interface
with a Supabase/PostgreSQL adapter. One authenticated user's devices and books
share an atomic quota across gateway replicas. This is implemented and locally
verified; deployment adoption and continuous Realtime policy remain open.

## Chosen scope

The requested cleanup worker cannot safely complete through the current
`mobile_list_project_snapshot_cleanup_paths` seam alone. It lists only published
manifest paths. Storage upload can precede manifest registration, so an orphan
upload is absent; new uploads can race cleanup; there is no durable lifecycle
freeze or checked metadata-removal transaction. An account workflow would also
need ownership/transfer handling before removing referenced identities. No
deletion wrapper, service credential or metadata-removal path was added. The
authorized fallback was shared gateway issuance enforcement.

The new migration builds on existing Auth/device/project checks, rather than
introducing another identity authority. `mobile_realtime_rate_policy` is private
and administrator-owned. `mobile_realtime_rate_windows` keeps one row per Auth
user, containing only identity, window start and count. Authenticated/anonymous
clients have no table privileges. The checked RPC accepts project/device IDs and
expected policy values, never a caller-selected user, clock or quota key.

Quota consumption uses the database clock and a per-user row lock. Both an
initial authority check and a check after acquiring the row lock precede the
count change. The second check catches revocation committed while a request
waited. Policy is locked for the transaction and must match gateway expectations.
Different gateway configuration cannot reset or increase a user's quota.

Production passes the user's already verified JWT and the existing publishable
key to that RPC. No service-role credential is needed. Ordinary project
authorization runs before quota contact, and SQL checks the session/device/project
again. A rejected quota returns 429 with database-derived retry timing. A missing
migration, changed policy, transport loss or invalid decision refuses issuance
with a generic 500. There is no process-local fallback or automatic retry: a lost
response may already have committed a quota slot. Later upstream failure also
does not refund it.

## Reproduction and evidence

```sh
python3 scripts/verify_shared_gateway_limiter.py --pg-bin /opt/homebrew/opt/postgresql@17/bin
```

The replay creates a disposable PostgreSQL 17.11 cluster with only a temporary
Unix socket, applies repository migrations, reruns the existing encrypted-sync
authorization SQL suite, creates synthetic identities through the real enrollment
RPCs, and runs every gateway check. It restarts and removes that cluster. No
deployed database, real credential, manuscript or provider call is used.

The HTTP adapter sends its real REST request to a loopback fixture. Each request
executes the actual quota/authorization SQL as `authenticated` using those
synthetic claims. This exercises HTTP serialization, transaction concurrency,
counter durability and gateway responses; it is not a real GoTrue/PostgREST or
Supabase Storage deployment. Existing JWKS tests exercise signed JWT verification
separately.

Observed checks:

- Twenty-four concurrent requests through two independent adapters, alternating
  devices and books: exactly five allowed and nineteen denied.
- Twenty-four concurrent requests through two live local gateway servers backed
  by that same SQL: five 201 responses, nineteen 429 responses and five synthetic
  upstream calls. The gateway clock was deliberately wrong; SQL owned time.
- Fresh adapter instances and an actual PostgreSQL restart retain exhausted
  quota. A different user's quota is independent; an expired window renews.
- Wrong project, revoked device, stale Auth-session claim, mismatched expected
  policy and direct client policy edits are refused.
- Lost HTTP response after SQL commit consumes once and is not automatically
  retried. A deliberate next request uses the existing counter.
- Real held-row tests observe the waiting quota query, revoke either the device
  or workspace membership, then release it. Both refuse issuance with no counter
  increment and no additional upstream call.
- Malformed/oversized responses, missing migration and transport errors fail
  closed without exposing raw hosted errors or tokens.
- All **33 gateway tests pass with zero skips**, plus TypeScript/build and the
  existing encrypted-sync authorization SQL suite. Standard gateway runs without
  the isolated database skip the dedicated integration case; this replay runs it.

The [initial red result](initial-red.txt) records the absent shared adapter and
the unsupported asynchronous interface. Independent root review then identified
the queued-revocation race: the [red SQL/HTTP result](queued-revocation-red.txt)
issued a 201 after device revocation. The [final check](checks.txt) includes the
repair and both queued-revocation cases. [Verification metadata](verification.json)
records versions, scope and source hashes.

The separate `shared-gateway-quota` CI job invokes the same disposable replay and
retains its raw output. Its configuration was reviewed locally; a remote CI run
has not been observed during this task.

## Rollout requirement and remaining limits

Apply `20261002120000_mobile_realtime_shared_rate_limit.sql` to the approved target
before switching its production gateway to this source. Defaults are five
issuance attempts per 60000 ms. An approved administrator must align the private
database policy and every gateway's `GATEWAY_RATE_LIMIT`/`GATEWAY_RATE_WINDOW_MS`.
Missing/mismatched policy refuses issuance; `/healthz` remains process liveness.
Run target-specific Auth-hook, RLS and real PostgREST adoption checks. This task
did not deploy the migration or change a real account's limits.

This quota governs issuance attempts. It does not measure money, concurrent
sessions or duration; enforce later `session.update` events; terminate already
issued calls after revocation; or establish billing policy. Those hosted
production controls, lifecycle deletion, trusted-device recovery/revocation UX,
physical-phone behavior and deployment drills remain open. Local SQL roles/claims
and loopback HTTP are deliberately separate from deployed authorization evidence.
