# Mobile build security containment — October 2, 2026

This is an assistant engineering assessment of local export tooling. The Forge
dependency audit and signed/native release gates remain open. No package,
cryptographic implementation or signing setting was changed. No credentials,
deployment, physical-device acceptance or live provider call was used.

## Fresh upstream check

The [GitHub advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv) still
covers node-forge through 1.4.0 and lists no patched release. The
[proposed upstream repair](https://github.com/digitalbazaar/forge/pull/1152)
remains open when checked. Public npm metadata reports Forge 1.4.0 as latest.
This is a timestamped observation, not a future availability guarantee.

Newer Expo releases exist: certificate helper 0.0.7, CLI 57.0.27 and Expo
57.0.26. Inspection of integrity-verified official helper/CLI archives finds no
verifier replacement: the helper still invokes certificate, RSA and CSR
verification through Forge; its functional CSR change adjusts the argument and
asserts the public key. It requests Forge `^1.4.0`; the latest CLI still requests
Forge `^1.3.3` and helper `^0.0.6`. Those updates cannot be treated as this
advisory's repair. They were not installed. Versions, immutable archive URLs,
integrity values and inspected file hashes are in [upstream-packages.json](upstream-packages.json).
The helper's [official source](https://github.com/expo/code-signing-certificates/blob/main/src/main.ts)
also retains these verifier calls.

The fresh [npm report](npm-audit.json) still reports five high dependency
entries propagated from one advisory. Its helper `fixAvailable: true` is not
evidence of a safe signing verifier. Its suggested Expo 44 downgrade is not
compatible with this Expo 57 application and was not applied. The installed
dependency/lock identities remain unchanged.

## Bounded implementation

`mobile/scripts/build-security.mjs` checks the real production dotenv and
config-plugin result, then exercises three installed development-signing header
branches with direct TCP/fetch attempts blocked. The current configuration has
no certificate, metadata or EAS project ID and all three branches return null
without a network attempt. A newly configured signing field or EAS ID refuses
the export before invoking the inspected signing helper or reading its configured key/certificate. This does not remove signing
protections: no configuration is rewritten, and activating signing requires
security review and an accepted remedy.

Existing web and hosted-test exports now run this guard, request source maps,
and check every expected platform and Metro bundle for affected verifier/helper
or signing modules. Missing, malformed, external or symlinked maps fail closed.
Indexed maps, `sourceRoot`, Windows separators and Metro virtual source names
are handled. The harmless CLI Metro loader is allowed. Successful inspected
maps are removed before app-shell caching; `security-build.json` records the
map and corresponding distributed-bundle hashes. CI also runs the config
check even when the unchanged dependency audit fails and preserves successful
build reports with its existing browser evidence. No advisory is suppressed.

The tests include actual installed-config/subprocess inspection and synthetic
configuration/plugin/dotenv/map fixtures. The first red record is an absent
guard interface, not an exploit reproduction. The first real export exposed a
valid Metro NUL-prefixed virtual source that the new parser initially refused;
the retained format regression fails before its correction and passes after.
See [results.json](results.json) for final checks, hashes and retained raw logs.

## Limits and removal

This contains the observed current export/configuration path; it does not fix
the installed RSA verifier or demonstrate resistance to forged signatures.
Direct Expo commands can bypass the wrapper. Source-map module absence covers
these Metro artifacts, not native OS crypto, native libraries, EAS servers,
store builds or a future configured update pipeline. Expo's
[supported update-signing configuration](https://docs.expo.dev/eas-update/code-signing/)
still requires its own signed-runtime/key-rotation acceptance. Those resources
were unavailable and were not certified.

After an accepted upstream patch or independently reviewed replacement exists,
update the dependency narrowly, re-audit it, test the actual configured signing
paths/artifacts, and explicitly revise this containment policy. Do not delete
signing fields, skip the audit or treat a successful guard as release approval.
