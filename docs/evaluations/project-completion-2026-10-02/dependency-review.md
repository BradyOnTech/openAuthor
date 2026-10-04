# Dependency review — 2026-10-02

The current audits report zero vulnerabilities for contracts, desktop and gateway. Mobile retains five high-severity dependency entries from one unpatched `node-forge` advisory. This is a point-in-time dependency check, not a release certificate. Full audit responses, installed versions, lockfile hashes and verification results are preserved in [dependencies.json](dependencies.json).

The checkout is based on `f154d78aaaafb5c1f0b42fdbe35b242aeadff705` with uncommitted implementation changes. The lockfile hashes identify the files actually checked; the commit alone does not identify this working state. Verification used Node `22.17.0` and npm `10.9.2`.

## Compatible patches

| Lockfile | Transitive package | Installed before → after | Existing parent range |
| --- | --- | --- | --- |
| `contracts/package-lock.json` | `fast-uri` | `3.1.6` → `3.1.8` | `ajv@8.20.0`: `^3.0.1` |
| `mobile/package-lock.json` | `brace-expansion` | `5.0.9` → `5.0.12` | `minimatch@10.2.6`: `^5.0.8` |

Each lock change updates only version, tarball URL and integrity. Published registry metadata supplied the tarball and integrity values. The fixes stay within existing parent ranges. `fast-uri` 3.1.8 addresses the current host/authority advisories; `brace-expansion` 5.0.12 addresses the current expansion/recursion advisories. See the maintainer's [fast-uri release](https://github.com/fastify/fast-uri/releases/tag/v3.1.8), [host-normalization advisory](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj), and [brace-expansion advisory](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr).

Desktop and mobile resolve `ajv@8.20.0` and `fast-uri@3.1.8` through their existing `file:../contracts` links. Their locks have no separate `fast-uri` entries. Gateway has no `ajv` or `fast-uri` dependency. Desktop and gateway lockfiles therefore remain unchanged. Contracts was reinstalled from its lock; refreshing mobile changed exactly one installed package. Browser tests finished before refreshing their shared dependency installation.

## Current verification

| Workspace/check | Result |
| --- | --- |
| Contracts audit | 0 vulnerabilities |
| Desktop audit | 0 vulnerabilities |
| Gateway audit | 0 vulnerabilities |
| Mobile audit | 5 high entries; one underlying advisory |
| Contracts typecheck and tests | Passed; 19 tests |
| Gateway typecheck, tests and build | Passed; 28 tests |
| Desktop mobile-sync contract consumers | Passed; 3 files, 21 tests |
| Mobile typecheck | Passed |

The initial gateway test run encountered sandbox `EPERM` errors opening local loopback listeners. A permitted rerun passed all 28 tests. These gateway fixtures did not contact a deployed service or an external inference provider. Separate whole-product and native/mobile acceptance results belong in their own evidence records.

## Remaining security gate

Mobile installs `node-forge@1.4.0` through `@expo/code-signing-certificates@0.0.6` and `@expo/cli@57.0.20`. The current Expo package is `57.0.18`; its WebRTC config plugin is `15.0.2`. The five audit entries are `node-forge`, those two Expo dependencies, `expo`, and `@config-plugins/react-native-webrtc`. They propagate the same signature-verification advisory, rather than representing five independent defects. The [official node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv) lists all releases through 1.4.0 as affected and no patched version. The [npm registry's latest release](https://registry.npmjs.org/node-forge/latest) was also 1.4.0 when checked.

The later [reachability analysis](forge-reachability.md) confirms calls into the affected verifier through Expo certificate, manifest and CSR helpers. Current resolved signing branches return without network access because the project has no signing certificate or EAS project ID. Fresh web/iOS/Android source-map exports exclude the affected modules. This scopes the observed JavaScript artifacts; it does not certify a signed distributed runtime, future signing configuration or overall release security. npm's suggested major downgrade to Expo 44.0.6 was not applied and is not an accepted remedy for the current Expo 57 stack.

To clear this gate, use a supported patched dependency or a reviewed, tested mitigation/replacement; establish affected-path reachability and rerun all four audits plus relevant contract and bundle checks. No audit suppression or unreviewed cryptographic patch was introduced. Live editorial usefulness, physical-phone acceptance, deployed authorization, signed/notarized architecture-specific installation, upgrades and accessibility remain separate project gates.
