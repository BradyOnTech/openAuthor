# Forge reachability — October 2, 2026

The affected RSA verification primitive is callable in installed Expo tooling.
The current app configuration does not activate the inspected development
manifest-signing branches. Forge and the certificate-signing helpers are absent
from the three inspected Metro runtime module lists. These are different findings;
they do not clear the dependency audit or certify a signed release pipeline.

The [official advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv) covers
node-forge through 1.4.0, with no patched version listed. Nested DigestAlgorithm
element validation can be bypassed in RSA PKCS#1 v1.5 verification, allowing
signature forgery for low-exponent RSA keys. The upstream
[proposed fix](https://github.com/digitalbazaar/forge/pull/1152) remains an open PR
when inspected. It was not applied or vendored. Mobile still reports five high
audit entries propagated from this one advisory.

## Installed paths and positive reachability

The installed versions are `expo@57.0.18`, `@expo/cli@57.0.20`,
`@expo/code-signing-certificates@0.0.6` and `node-forge@1.4.0`.
Paths below are relative to `mobile/node_modules/`; exact file hashes are in
[forge-reachability.json](forge-reachability.json).

| Call | Installed evidence |
| --- | --- |
| Development manifest handler requests signing info | `expo/node_modules/@expo/cli/build/src/start/server/middleware/ExpoGoManifestHandlerMiddleware.js:152` calls `getCodeSigningInfoAsync` with resolved app config and the client's signature header. |
| Configured project certificate is validated | `expo/node_modules/@expo/cli/build/src/utils/codesigning.js:308` calls `validateSelfSignedCertificate` after reading the configured certificate and private-key files. |
| Certificate validation verifies its signature | `@expo/code-signing-certificates/build/main.js:176` calls `certificate.verify(certificate)`; `node-forge/lib/x509.js:1187` delegates to `_verifySignature`, and `:782` calls RSA `publicKey.verify`. |
| Manifest signing verifies the resulting signature | CLI `codesigning.js:401` calls `signBufferRSASHA256AndVerify`; the certificate helper at `main.js:203` calls RSA `publicKey.verify`. |
| Development certificate creation verifies a CSR | Certificate helper `main.js:246` calls `csr.verify`; Forge `x509.js:1842` delegates to the same RSA primitive. This helper's availability does not prove an openAuthor server invokes it. |
| Affected default verifier | Forge `rsa.js:1142–1146` defaults to PKCS#1 v1.5. At `:1174–1175`, it validates the outer DigestInfo sequence length without the additional nested element-count check proposed upstream. |
| Native iOS signing identity inspection | CLI `run/ios/codeSigning/Security.js:57–70` reads a local Keychain certificate using `security` and parses PEM. This inspected path does not call RSA signature verification. |

The reproducible local probe exercises the first three certificate-helper calls
with a benign synthetic key/certificate/CSR held only in memory. A pass-through
wrapper counts three calls into the real installed RSA verifier. The generated
public exponent was 65537. This establishes primitive reachability, rather than
an exploit or an attacker-controlled input/trust path. No private keys or
certificates were persisted, and no Apple identity was created or used.

## Current configuration and runtime exports

Resolved Expo config has no `updates.codeSigningCertificate`, no
`updates.codeSigningMetadata`, and no EAS project ID. With TCP connections and
fetch blocked, the installed `getCodeSigningInfoAsync` returned `null` for all
three checks: no signature header; an `expo-root` header without an EAS ID; and a
project-key header without a configured signing certificate. Zero network
attempts occurred. These results correspond to CLI `codesigning.js:173–176`,
`:212–220` and `:257–264`. Supplying a private-key path without a certificate
instead produces a configuration error; it is not a supported bypass.

The existing final local web/iOS/Android export hashes are retained in the JSON.
None contains the selected Forge verifier error strings, but negative string
searches alone cannot prove code absence. A separate offline all-platform Expo
export with source maps provides stronger module evidence: 402 web, 848 iOS and
846 Android mapped sources contain no node-forge, certificate-signing helper or
Expo signing module. All three include the Expo CLI's Metro `require.js` loader;
the claim is not that every CLI module is absent. The full mapped source lists
are retained in [forge-module-lists.json](forge-module-lists.json), with map and
bundle hashes in the probe result. This source-map build is distinct from the
earlier acceptance bundles; its hashes are not substituted for theirs.

The [offline export output](forge-source-map-export.txt) is retained. Reproduce
the source-map export with the command recorded in the JSON, then run
`node docs/evaluations/project-completion-2026-10-02/forge-reachability.mjs`.
The inspection changes no app source, dependency lock or cryptographic code.

## Remaining gate

The audit remains open until a supported patched dependency or a reviewed,
tested mitigation/replacement is adopted and audited. Recheck any future
certificate/EAS/update configuration and its resulting artifacts. This local
analysis does not establish the native OS signing implementation, a deployed
EAS/server trust path, embedded native dependencies, native device behavior, or
an attack against a signed distribution. It does not certify the dependency as
harmless or every affected call as build-time-only. No audit was suppressed and
no Expo downgrade was applied.
