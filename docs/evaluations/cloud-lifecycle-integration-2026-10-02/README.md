# Combined cloud lifecycle checkpoint — 2026-10-02

The frozen source committed as `e7712d37e7febb7723968324628f31238e9fa268` passes **94/94 gateway tests
without skips**, TypeScript/build, **eight SQL suites** and **16 actual queued
transaction controls**. Six voice cases exercise real PostgreSQL, loopback HTTP,
private role boundaries and process/database failure recovery.

The [results](results.json), [source manifest](source-sha256.json),
[tested input archive](tested-source.tar.gz) and compressed original logs preserve
what was executed. Input hashes were captured before the run and checked unchanged
after it. The earlier failing logs retain their original scopes: an obsolete SQL
refusal expectation and a mixed-input run before the final closed-claim repair.
Neither is presented as a passing current checkpoint.

Reproduce from the tested source with an available PostgreSQL toolchain:

```sh
python3 scripts/verify_shared_gateway_limiter.py --pg-bin /path/to/postgresql/bin
```

This creates and stops a disposable fsynced Unix-socket database. Auth, Storage
and provider HTTP effects are synthetic; no existing account, database or hosted
backend was altered. Target Storage backing/queue verification, live provider
behavior, unknown allocation reconciliation, complete control outage limits,
retained-project intent amendment, physical phones and signed/native acceptance
remain open. See the [completion review](../project-completion-2026-10-02/review.md).
