# Pinned local Forge Node verifier — 2026-10-03

The pinned local Expo Node/lib PKCS#1 v1.5 verifier now rejects unconsumed DigestInfo children, nonempty primitive NULL parameters, noncanonical DER lengths and noncanonical OID bytes. The canonical change is committed at `ba245b1d75c4a6ca1bf402080f6646ce9f4aa6b3`; its installed RSA postimage SHA-256 is `3dde91b05b403e062e0c7c8e97e63e79337c651db59f18fa7c836d18b15697d5`. This is local maintained validation, not raw advisory closure or release certification. All six priorities remain in progress.

## Two preserved phases

| Phase | Source and recorded verification | Scope |
| --- | --- | --- |
| Historical cardinality patch | `82e5b3672d09b0850feb6b1a5cac8964100f75a6`; 48 focused tests, 277 full tests in 35 files; typecheck/check/preflight and normal web/iOS/Android export pass | Extra AlgorithmIdentifier-child count only. Primitive NULL content and canonical encodings were still unchecked. |
| Canonical regression control | Old postimage `16eefbcc077f2e91ea017fa87d0186c747f0d439df2765b5d59b4c0ba67a9068`; three new cases fail while 23 prior cases pass | Isolated malformed NULL, noncanonical length and OID controls. No exploit or forgery claim. |
| Canonical validation | `ba245b1d75c4a6ca1bf402080f6646ce9f4aa6b3`; 52 focused tests in two files, 281 full tests in 35 files, zero failures/skips; typecheck/check/preflight and normal all-platform export pass | 100 source inputs captured before green verification match the committed/reviewed bytes. Only the manifest patch/scope/reference, tests and README changed from the historical phase. |

Four independent static source reviews report no open findings: Standards and Spec for each committed phase. Their raw reports/hash manifests are retained. Tests use locally generated synthetic keys and actual installed Expo certificate/CSR/development-certificate/manifest helpers with Node/OpenSSL controls; test private keys were not persisted. No real signing identity, provider, cloud service or device was exercised.

The earlier phase's full pass predates final manifest scope clarification. Its guard, patch and test code remained unchanged; a final 100-file capture preceded the repeated 48-test focused run. The final README was subsequently rewrapped only, and the final seven-file independent reviews and commit receipt correlate that final state. Original `final-seven.json` still says replacement Standards review was pending and source uncommitted at its capture time; later retained review/commit receipts supersede those historical labels. Originals were not rewritten. The canonical green capture starts after local RSA application; this phase has no separate retained apply-invocation receipt. Its recorded check/preflight/export results correlate the canonical postimage. The recorded apply invocation belongs to the historical phase.

## Defensive behavior and compatibility

The pinned guard verifies known package/lock/caller inventories and resolution before atomic local replacement, then reinspects the bytes. Supported npm lifecycle hooks and direct guarded export/preflight entry points share the guard. Unknown bytes, copies, symlinks or inventories fail closed; it does not learn new bytes automatically. The original RSA preimage and both exact replacement strings/hashes are retained, allowing byte reconstruction without executing cryptography.

The existing ASN.1 schema must succeed before nested access. Complete child counts, empty captured NULL, whole-object DER equality and OID decode/re-encode equality bind the consumed encoding. Existing recognized-hash choices and MD2/MD5 required-NULL behavior remain. SHA identifiers with absent or empty NULL parameters remain supported. Older BER-only forms are deliberately refused; this distinction is described in [RFC 8017 §9.2](https://www.rfc-editor.org/rfc/rfc8017#section-9.2), with SHA parameter compatibility in [Appendix B.1](https://www.rfc-editor.org/rfc/rfc8017#appendix-B.1).

Canonical whole-byte equality also applies when the unsupported diagnostic `_parseAllDigestBytes:false` option is supplied. Unsafe diagnostic padding options, PSS/NONE/custom schemes and general ASN.1 library behavior are outside the new validation claim. This packet is not an exhaustive cryptographic certification.

Both normal guarded exports inspected three Metro source maps and then removed them. Original `security-build.json` reports retain the map hashes; raw web and iOS/Android Hermes bundle bytes are archived and match their reported hashes. **Actual maps are not retained**, so map inspection cannot be independently replayed from this packet. A static export is not actual native device, signing or store acceptance.

No fresh `npm ci`, `npm audit`, dependency download, signing/system change, deployment or writing-provider call is claimed. Forge's version remains 1.4.0. Raw Forge/Braces audit and release gates, browser distributions, global/cloud EAS, signed native artifacts and actual devices remain open. Direct Expo commands and disabled npm lifecycle scripts require separate verification. Root's green receipt records four unchanged author artifact hashes; raw author data and ambient environment dumps are not copied.

## Packet contents and verification

| File | Retained evidence |
| --- | --- |
| `initial-node-backport.tar.gz` | All 48 original historical phase files, including logs, invocation receipts, input archives, original RSA bytes, commit receipts and normal export artifacts |
| `canonical-node-verifier.tar.gz` | All 41 original canonical phase files, including red/green source captures and logs, commit receipts and normal export artifacts |
| `source-reviews.tar.gz` | Nine unchanged files from four independent final review directories |
| `receipts.json` | Per-original archive/member SHA-256, sizes and private paths |
| `results.json` | Separate phase outcomes and explicit limits |
| `verify.py` | Read-only integrity and receipt correlation |
| `evidence-sha256.json` | Final packet file seal |

Archived helpers are historical source material; do not replay them against sealed private roots. The integrity verifier does not execute helpers, install dependencies, invoke Node/crypto/tests/export, extract archives, inspect processes, change Git or access the network:

```sh
python3 -B mobile/evidence/2026-10-03-forge-node-verifier/verify.py
```

It checks original bytes, nested source snapshots, red/green counts and terminal receipts, review/commit correlations, both reconstructed RSA postimages and exported artifact hashes. It checks that map hashes were recorded, not their unavailable map contents. Optional `--current` also hashes the current 100 source inputs and installed RSA file; source drift or an absent installed dependency is reported, not repaired. The verifier proves retained integrity, not acceptance replay or release readiness.
