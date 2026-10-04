# Repository node-forge fork

This is `@openauthor/node-forge@1.4.0-openauthor.1`, derived from the immutable
`node-forge@1.4.0` npm archive. It is a modified distribution, not an upstream
fix. Its RSA PKCS#1 v1.5 verifier requires complete canonical DER DigestInfo,
complete nested AlgorithmIdentifier sequences and empty NULL parameters.
The existing BSD/GPL license choice and upstream attribution are retained.

Only the Node/CommonJS source implementation is distributed. The upstream
unpatched minified browser distributions and obsolete Flash binary are removed.
Expo uses the patched `lib` implementation. Signing activation and Metro export
containment remain guarded; this package does not certify EAS, browser signing,
global Expo installations, native binaries or physical devices.

GHSA-86w9-cpqp-85rv remains open upstream. The scoped fork has no upstream npm
advisory identity: a clean npm audit cannot establish its safety. Whole package
inventories, caller resolution guards and the Node/OpenSSL differential and
adversarial signature tests remain mandatory. Replace this fork only after
reviewing an upstream release against those tests.
