# Modified security distributions, October 4, 2026

The unchanged raw audit originally returned 17 high dependency entries, derived
from two advisories. Both upstream advisories still list no patched version:
[Braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and
[node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
The npm registry's latest releases are 3.0.3 and 1.4.0 respectively. The
[Braces maintainer issue](https://github.com/micromatch/braces/issues/70) and
[Forge maintainer issue](https://github.com/digitalbazaar/forge/issues/1149)
remain open. The official archive integrity receipts are preserved here.

The repository now distributes actually modified, scoped local packages with
their existing reviewed patches. The npm lockfile identifies the forks and
their exact file archive integrities. Forge's unpatched browser bundles/maps
and Flash binary are omitted. Root dependency overrides route all transitive
callers to regular installed fork package files. Only these two dependency
entries changed. Both embedded Braces copies retain the exact prior repairs.

`audit-before.json` records 17 high entries; `audit-after.json` records zero
vulnerabilities at the same `--audit-level=low` threshold. This is a registry
identity result, not independent proof of fork safety. Source and archive
integrity, installed inventories, original/fork aliases and duplicate copies,
actual caller resolution and adversarial behavior tests remain mandatory.
No advisory is suppressed, and the guards keep the upstream advisory state
open and require a separate raw audit.

Reproduce the distributions offline with
`python3 mobile/scripts/package-security-forks.py check`. Both Python 3.11 and
3.13 reproduced the committed archives exactly. `security/forks.json` lists
every original and distributed source hash. The original tarballs are licensed
diagnostic/source material; they are never installed by the mobile lockfile.

Validation used Node 22.17.0/npm 10.9.2. A fresh `npm ci --prefix mobile` completed
with all lifecycle guards enabled; the standalone forks were already repaired
and postinstall repaired the two embedded Braces bundles. TypeScript checking
and offline signing preflight passed. The preflight checked three signing-header
branches with zero network attempts. Guarded web and all-platform Metro exports
passed source-map containment, excluding signing and pattern tooling from all
three platforms. Export receipts and raw command results are preserved here.

Full mobile suite results are recorded in `tests.txt.gz`. Early worktree runs first
lacked the adjacent contracts package dependencies, which were bootstrapped
with `npm ci --prefix contracts`. Added grouped forensic alias cases exceeded
their per-test timeout while other builds ran. Each case now has its own test;
byte-for-byte bundle comparison uses native `Buffer.equals` to avoid expensive
assertion traversal. The same cases and exact byte equality remain required.

This evidence covers repository dependency distribution, installed Node tooling
and Metro exports. Signing activation, global/cloud EAS, signed native builds,
physical devices and store acceptance remain unverified and unchanged. These
forks create an explicit maintenance obligation until reviewed upstream
replacements pass the same tests.
