# Authenticated book key recovery — 2026-10-02

The desktop now restores its own missing current-version envelope after proving an entered OA1 recovery key against an existing committed encrypted book snapshot. A key already independently loaded from the device envelope or generated during provisioning still uses the existing nonextractable AES-GCM challenge comparison.

## Verification boundary

The initial read captures the exact active/latest book key authority and the signed account/device/session identity. The recovery reader obtains only the newest committed manifest for that reviewed active version through `mobile_get_recovery_snapshot`; the ordinary envelope-filtered manifest API is unchanged. The RPC supplies a ciphertext locator rather than a claim that the candidate key is correct.

The client checks project/version, snapshot UUID, project-scoped object path, ciphertext size (at most 64 MiB), both ciphertext digests, nonce length and the existing encrypted format. It authenticates the hosted manifest with snapshot/project/revision/key-version AEAD identity, requires the same identities in its decrypted body, decrypts the exact object with project/revision/key-version AEAD, checks the authenticated plaintext digest, and validates the plaintext manifest and snapshot project/revision/schema/collection identity. Decrypted prose is transient. No candidate is installed, persisted, logged or used for publication before the full proof succeeds.

After proof the client rechecks original authority/session, seals the key only to the public key loaded from this desktop's validated Keychain identity, and calls the self-only expected-version/device-key installation RPC. It confirms the complete immutable SQL receipt (`id`, project/version, sender/recipient identities, algorithm, ciphertext and digest). An ambiguous installation response receives one exact own-envelope readback; it never repeats the mutation. Failure keeps publication locked and the same-account masked input available. A deliberate reconnect can independently unwrap an envelope that committed despite a lost response.

The candidate replaces in-memory key state only after final live authority/session checks. Key retirement, rotation, device-key drift, sign-out, account/device changes and a later sign-in to the same account refuse stale completion. Ordinary token refresh within the same signed session remains valid. Publication remains explicit.

## Retained evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Baseline behavioral reproduction | 1 expected failure: valid current-book encrypted snapshot was unavailable to standalone recovery | `absent-envelope-recovery-red.txt` |
| Actual composite wire reproduction | 1 expected failure when SQL returned `id` rather than the initially assumed `envelope_id` | `recovery-envelope-wire-red.txt` |
| Focused crypto, adapter, coordinator/race, enrollment and UI suites | 140 passed across 9 files | `desktop-focused.txt` |
| Complete desktop suite | 547 passed across 84 files | `desktop-full.txt` |
| TypeScript and production build | passed; existing Vite large-chunk advisory remains | `desktop-build.txt` |
| Public desktop recovery browser journeys | 3 passed in 4.1 seconds | `browser.txt`, `authenticated-key-recovery-laptop.png` |
| Source provenance | SHA-256 of the 14 desktop source/test files and consumed SQL migration/test contract | `results.json` |

The browser uses the actual `MobileInboxPanel`, connection/enrollment code, coordinator, RPC adapter, libsodium sealed boxes and published-format AES-GCM crypto. Synthetic account, secret-store and HTTP responses are the explicit outer boundaries. It covers a distinct checksum-valid wrong key, damaged object refusal with retained input, exact lost-reply confirmation, successful self-envelope recovery, independent reconnect/unseal, explicit publication, same-account new-session login during paused proof, and an indeterminate committed installation resolved by reconnect without another write. The 1024×768 image checks reachable recovery and publication controls; it is an isolated rendered fixture rather than the packaged native application's styling.

The crypto tests additionally cover altered project/snapshot/revision/version AEAD identities, manifest and object corruption with recomputed public hashes, wrong plaintext book identity and raw-key erasure after sealing. Coordinator tests cover rotation/revocation/session races before and after installation, device-key refusal, missing proof, uncertain outcomes, overlapping publication refusal and retaining an original verified key when a fast-path authority check changes.

Peer read-only review found and resolved the SQL response identity and same-account new-session fence issues, then found no further material recovery crypto/privacy/race defect. PostgreSQL locking/role/Storage authorization evidence is maintained separately by the SQL lane; these browser checks do not claim deployed Supabase, live Auth, native Keychain or live Storage behavior. No live accounts, providers, deployments or private author data were used or changed.

## Remaining limits

Snapshot recovery needs an available committed snapshot encrypted with the current active key. It refuses absent, oversized, unavailable, damaged or identity-mismatched ciphertext and cannot revive retired key authority or a revoked enrollment. An existing envelope or a reviewed new key rotation is still required when no current snapshot can authenticate the candidate. This operation restores only this desktop's envelope, does not redistribute keys to other devices, erase offline copies or republish automatically. The paired SQL migration must be applied before this hosted recovery path is available. A separate project-bound key commitment is future work; this implementation uses the existing authenticated snapshot format as the proof.
