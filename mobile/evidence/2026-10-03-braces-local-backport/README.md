# Pinned local three-copy Braces mitigation — 2026-10-03

The local maintained Braces sources at `98f4d4a67c32941b23beb5d7bcdaf1d6e901bfbe` bound parser/AST stack paths and remove recursive queue flattening/append across the standalone `braces@3.0.3` package and seven Braces modules embedded in `resolve-workspace-root@2.0.1` and `expo-doctor@1.20.4`. All nine installed target hashes are pinned; eight target files differ from their originals. This is local defensive validation. Raw dependency audit, signing/artifact acceptance and all six priorities remain open.

## Preserved phases

| Phase | Recorded outcome | Scope |
| --- | --- | --- |
| Initial focused candidate | 5 failures / 262 passes, four files | Three real null-child controlled-validation failures and two test-fixture issues were found; original source/logs remain intact. |
| Intermediate candidate | 1 failure / 271 passes, four files | The remaining fixture imported an internal Metro path blocked by package exports; the final fixture resolves the exact installed absolute path. |
| Final root validation | 272 focused checks, 501 full mobile checks in 37 files; zero failures/skips | Typecheck, both maintained guards, offline preflight and explicit web/iOS/Android exports pass against the captured final 113 inputs. |
| Fresh mobile-only install | Offline `npm ci` installs 561 packages; both backports apply; 272 focused checks and preflight pass | Its TypeScript check fails with missing `ajv/dist/2020.js` because the sibling contracts package dependencies were not installed. This original failure remains retained. |
| Sibling contracts bootstrap | Exact sibling-lock offline `npm ci`, mobile TypeScript retry, idempotent guards and fresh web/iOS/Android exports pass | 144 exact inputs: original 143 plus the committed contracts lock. Actual bootstrap occurred after mobile CI; the original failed check remains unchanged. This is not a full `make install-js` execution. |

The final 17-file Standards and Spec reviews have zero open findings. Standards records 314 static relationship checks. Its final source snapshots and both final reviewed hash manifests match the final 113-file capture. Earlier intermediate review metadata, including the prior fixture hash, stays unchanged alongside the final review. Reviewers did not execute modules, probes or suites; execution receipts belong to root.

## Behavior and limits

`maxDepth` defaults to and is capped at 100; supplied values must be safe nonnegative integers. Combined brace/parenthesis nesting, every plain-data AST child path and independent parent ancestry are bounded before recursive walkers or expansion mutation. Child/parent/queue cycles and non-scalar/coercible values are refused. Shared acyclic subtrees, finite stale parent links and ordinary legacy metadata remain compatible. Flatten/append use explicit frames; range argument binding and ordinary ordering remain unchanged. The 10,000-character input ceiling applies independently of `maxLength`.

The guard checks exact licensed sources, complete owner inventories, caller/lock/resolution bytes and original/postimage hashes before per-file atomic replacement. A repeat apply repairs recognized original/patched mixtures; checks refuse incomplete mixtures and unknown bytes. This is not a transaction across all targets. Arbitrary getters/proxies, custom transforms, combinatorial output and other resource bounds are outside the stack mitigation.

Original licensed package/caller sources, all 14 original embedded module entries and three 113-file candidate captures are retained. The verifier reconstructs the nine final postimages as bytes without evaluating JavaScript. Tiny cyclic controls ran only against patched implementations; no original exhaustion probe is claimed in these receipts. Actual embedded-copy behavior uses private adapters exposing only Braces; Doctor main/network operations are not exercised.

Normal root exports include the initial default web-only run and the corrected explicit three-platform run. The later fresh fixture also exports all three platforms. Raw artifacts and original reports are retained separately; byte-identical reproducibility is not claimed. The guard inspected then removed one, three and three source maps respectively. Their hashes remain, but their unavailable bytes prevent independent map reinspection. Exports do not establish native device or signing acceptance.

The initial apply log/receipt was overwritten by the final apply using the same filename. The retained invocation is the final post-repair application; initial failures/source/reset evidence remains, without reconstructing the lost invocation. Driver source was captured after later command additions; per-command invocation receipts bind actual execution. Fresh preparation records still say `prepared_not_executed`; separate terminal receipts supersede that historical label without changing it.

The fresh mobile cache was prepared from 531 integrity-addressed public blobs plus one exact mobile-lock `brace-expansion@5.0.12` download. The separate eight-blob contracts cache needed one exact contracts-lock `fast-uri@3.1.8` download. Actual npm execution used offline package fetching and enabled lifecycle scripts; offline is not a network sandbox for arbitrary child scripts. Cache hash/integrity and both download receipts are retained; cache tarballs and full installed dependency trees are omitted. The packet cannot replay `npm ci` from retained bytes alone. No audit, writing-provider, deployment, signing/system or physical-device acceptance is claimed. Package versions and raw audit gates remain unchanged.

Root's post-terminal receipt correlates 113 root/144 fresh sources, both 17-file final review manifests, all nine targets in each installation and four unchanged author artifact hashes. The source commit contains exactly the 17 reviewed Braces files. Raw author data is not copied. A separate repository marker check initially returned exit 0 while stderr reported missing `rg`; this invalid result is retained and never counted as passing. A corrected-PATH check passed before a separate Makefile repair. That later repair is outside this packet's 17-file source scope.

## Packet and verification

| File | Contents |
| --- | --- |
| `root-validation.tar.gz` | Historical failures, candidate/final captures, final logs/invocations, drivers and normal export artifacts |
| `original-design.tar.gz` | Independent 94-file original capture, embedded slices and evolving design findings |
| `source-reviews.tar.gz` | Final and intermediate independent reports/manifests plus final source snapshots |
| `fresh-mobile-only.tar.gz` | Original preparation/cache/tool receipts, exact 143 source files, actual mobile CI/focused/preflight and failed typecheck |
| `fresh-contracts-bootstrap.tar.gz` | Separate sibling lock/cache preparation, missing-package/download history, actual contracts CI, successful mobile retry/idempotence, driver and all-platform artifacts |
| `source-commit.tar.gz` | Exact source commit, post-terminal hash correlations and invalid/corrected-PATH marker-check records |
| `receipts.json`, `results.json` | Per-original hashes, outcomes and explicit boundaries |
| `verify.py`, `evidence-sha256.json` | Read-only integrity/receipt correlations and final seal |

Archived helpers are evidence, not instructions to replay against sealed private roots. The verifier never extracts archives, runs dependencies/tests/helpers, installs packages, invokes exports, inspects processes, changes Git or accesses the network:

```sh
python3 -B mobile/evidence/2026-10-03-braces-local-backport/verify.py
```

Optional `--current --repo /absolute/repository/path` also hashes current 113 source inputs and nine installed target files. It reports drift without repair. Retained integrity is not acceptance replay or release certification. The primary [Braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [upstream proposed patch](https://github.com/micromatch/braces/pull/72/files) remain separate from this maintained local mitigation.
