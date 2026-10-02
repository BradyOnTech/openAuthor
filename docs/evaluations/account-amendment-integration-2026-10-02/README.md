# Reviewed account correction integration — October 2, 2026

The source committed as `9d31cf8647d3afd996c3f8ddb8c0df99022f1ed4` passes **626 desktop tests in 88 files**, TypeScript/production build, **nine journeys in each of Chromium and WebKit**, **nine SQL suites**, **24 concurrency/isolation controls**, and **94/94 gateway tests with no skips**. Independent Standards and Spec re-reviews have no open findings.

The desktop flow now reviews changes to originally retained shared books after account deletion begins. Explicit selected corrections bind a fresh review and exact amendment UUID; uncertain replies reconcile through the exact durable receipt before current progress. The account-only enrolled client retains that UUID across status reads. Known PostgreSQL rejection requires a complete bounded PostgREST error response; malformed or transport errors stay unresolved.

The [results](results.json), [captured input hashes](source-sha256.json), [selected source archive](tested-source.tar.gz), compressed original logs and [current laptop screenshot](reviewed-corrections-laptop-webkit.png) retain the observed scope. All 83 captured inputs matched their pre-run fingerprints after final desktop/build/browser/database runs and match this commit. The archive contains selected affected inputs, not the complete application; full desktop reproduction requires the commit and its locked dependencies. The two failing logs preserve pre-repair controls and are not current certification. The [SQL packet](../account-deletion-amendments-2026-10-02/README.md) independently preserves and replays the original retained-scope trap and final SQL controls.

Run `npm test` and `npm run build` from `desktop/`. Run the two named browser specs with actual Chromium and WebKit engines separately, using one worker and the existing Playwright server/fixture configuration. From the repository root, run:

```sh
python3 scripts/verify_shared_gateway_limiter.py --pg-bin /path/to/postgresql/bin
```

This starts and stops a new disposable fsynced Unix-socket database. The amendment lane has seven real queued lock controls and one repeatable-read refusal; the aggregate 24 also includes the existing project, bootstrap and account concurrency/isolation controls. Six gateway voice cases exercise real PostgreSQL, loopback HTTP and process failure boundaries. Storage, Auth and provider HTTP effects remain synthetic. No existing database, actual account, provider, private book or deployment was changed.

Unknown absent projects require independent permanent deletion receipts and operator evidence. Current-source native account management, Keychain/signing, deployed backing/queue verification, physical phones and fresh-prose author judgment remain open. The [dependency recheck](../mobile-dependency-recheck-2026-10-02/README.md) retains the unpatched mobile advisory. See the [completion review](../project-completion-2026-10-02/review.md).

The independent evidence and documentation audit found no material discrepancies. It verified 195 integration hash comparisons and 76 comparisons in the earlier SQL/dependency packets, checked the raw result counts, and confirmed prior checkpoints remain unchanged. The separate dependency packet records public package download-time integrity hashes; those public archives were not retained for offline recomputation.
