# Mobile dependency follow-up — fresh October 3 UTC check

The mandatory dependency gate remains open. A fresh audit finished at
**2026-10-03 02:09:08 UTC**, against commit
`4a27acdac2ba2c6f87171c86dd9b3bab691f81f2`, and now reports **17 high dependency
entries from two root advisories**. The earlier October 2 result of five entries
is retained as historical evidence, not relabeled as current. Package, lockfile
and build-security guard hashes remain unchanged. This folder's October 2 date
uses the workspace's America/Chicago calendar date.

| Root advisory | Current official coverage | Latest public package | Patched release |
| --- | --- | --- | --- |
| [Forge signature verification](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Forge through 1.4.0 | [1.4.0](https://registry.npmjs.org/node-forge/latest) | None listed |
| [Braces stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Braces through 3.0.3 | [3.0.3](https://registry.npmjs.org/braces/latest) | None listed |

Forge's [repair PR #1152](https://github.com/digitalbazaar/forge/pull/1152) remains
open/unmerged. Latest official [Expo 57.0.26](https://registry.npmjs.org/expo/latest),
[CLI 57.0.27](https://registry.npmjs.org/@expo%2Fcli/latest) and
[certificate helper 0.0.7](https://registry.npmjs.org/@expo%2Fcode-signing-certificates/latest)
do not establish a repair: the helper still delegates certificate/RSA/CSR
verification to Forge and requires `^1.4.0`; CLI requires Forge `^1.3.3` and
the helper `^0.0.6`. Their freshly integrity-verified archive hashes exactly
match the prior inspected sources. Installed Forge RSA source matches the fresh
official 1.4.0 archive byte for byte.

The additional braces check finished at **02:10:38 UTC**. Its official advisory
was updated October 2 at 22:36:34 UTC, after the prior audit. Installed
micromatch 4.0.8 requires braces `^3.0.3`; the
[latest micromatch](https://registry.npmjs.org/micromatch/latest) has the same
requirement. The new audit propagates braces coverage through Metro, Expo and
React Native. [Expo Metro 56.1.0](https://registry.npmjs.org/@expo%2Fmetro/latest)
is available, outside Expo's inspected `~56.0.2` requirement; it is not an
established supported advisory repair. npm's suggested Expo 44 / React Native
0.72 downgrades were not applied.

No supported released repair was found in the inspected official dependency
chain. Acceptance requires an accepted patched dependency or independently
reviewed replacement for both advisories, a fresh audit, and actual configured
signing/native artifact verification. Current export containment does not clear
these dependency gates. No exploit or runtime-input reachability finding is
claimed for braces.

## Reproduce and verify

Run `python3 mobile/evidence/2026-10-02-dependency-recheck-followup/collect.py`
and then `python3 mobile/evidence/2026-10-02-dependency-recheck-followup/collect-new-advisory.py`
from the repository root with public npm/GitHub access. Retain this packet before
a later run: the collectors overwrite their own timestamped observations.
The audit uses distinct empty user/global npm configuration files and a
disposable cache. Public archives are integrity-verified without installation
or execution. No package, source, lockfile, signing, EAS, deployment, account,
secret or provider operation was changed.

[results.json](results.json) contains command, timestamps and source hashes;
[npm-audit.json](npm-audit.json) retains the fresh audit;
[additional-advisory.json](additional-advisory.json) retains the additional
official check; [assessment.json](assessment.json) distinguishes the two
advisories and limits. [packet-sha256.json](packet-sha256.json) binds this packet.
