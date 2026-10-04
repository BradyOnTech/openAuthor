# Mobile dependency advisory recheck — October 2, 2026

The mandatory dependency gate remains open. This read-only recheck finished at
20:10:46 UTC against commit `118641f6d651144740ce52a6fa8f0befbea92ff7`.
No supported released repair or verifier replacement was found in the inspected
official packages.

The [official advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv) still
lists Forge through 1.4.0 as affected and identifies no first patched version.
The [upstream repair](https://github.com/digitalbazaar/forge/pull/1152) remains
open and unmerged. Public npm metadata still reports
[Forge 1.4.0](https://registry.npmjs.org/node-forge/latest) as latest. The actual
installed RSA source matches that integrity-verified public release byte for byte.

Newer [Expo 57.0.26](https://registry.npmjs.org/expo/latest),
[CLI 57.0.27](https://registry.npmjs.org/@expo%2Fcli/latest) and
[certificate helper 0.0.7](https://registry.npmjs.org/@expo%2Fcode-signing-certificates/latest)
remain available. The CLI and helper archive hashes exactly match the earlier
[source inspection](../mobile-build-security-2026-10-02/README.md). The helper
continues using Forge for certificate, RSA and CSR verification and requests
Forge `^1.4.0`; the CLI requests Forge `^1.3.3` and the helper `^0.0.6`.
Updating these parents alone does not remove the affected verifier.

The fresh [npm audit](npm-audit.json) exits 1 with five high entries propagated
from this one advisory. Its suggested Expo 44 downgrade is outside this
application's Expo 57 dependency range and was not applied. The installed tree
is Expo 57.0.18, CLI 57.0.20, certificate helper 0.0.6 and Forge 1.4.0.

The current offline build preflight again passes three signing-header checks
with zero network attempts. That proves only the current configuration's
containment path. It does not patch RSA verification or certify signed native,
EAS or update-signing behavior. Prior Metro export evidence remains separately
scoped; no new native or runtime export is claimed here.

Accepting this gate requires a supported patched dependency or an independently
reviewed replacement, a fresh audit of the resulting installed tree, and
verification of the actual configured signing pipeline and signed/native
artifacts. No package, lock, cryptographic implementation, signing setting or
audit policy was changed. No provider, deployment or account operation occurred.

## Reproduce and inspect

From the repository root, run
`python3 docs/evaluations/mobile-dependency-recheck-2026-10-02/recheck.py` with
public npm/GitHub network access. It creates a disposable npm cache and distinct
empty user/global config files, downloads integrity-verified public archives
without installing or executing them, and verifies package/lock/guard hashes
remain unchanged. Rerunning overwrites these timestamped observations; retain
the existing packet before recording a later recheck.

[results.json](results.json) records the observed inputs, commands and artifact
hashes. [assessment.json](assessment.json) records the engineering conclusion.
[packet-sha256.json](packet-sha256.json) binds the retained packet. The initial
npm configuration refusal is preserved and is not a dependency result.
