# openAuthor mobile companion

This Expo/React Native app is a read, conversation, capture, and review companion. It intentionally does not expose direct manuscript mutation.

## Browser / PWA

The same app now targets the browser. From the repository root:

```sh
make install-js
make mobile-web
make mobile-web-build
make test-mobile-e2e
```

`mobile/dist` is the static hosting output. Serve it at an HTTPS origin root;
plain HTTP on a phone's LAN address cannot use the microphone. On iPhone, use
Safari's Add to Home Screen; on Android, use the browser's install action. Voice
is foreground-only and requires a network connection.

Configure the public values in `.env.example` before building. Permanent OpenAI
credentials belong only in the Session Gateway. Deploy the browser-platform
migration along with the existing mobile sync migrations, configure the gateway's
allowed browser origin, and enable the project and review its current key from
desktop Mobile Inbox before enrolling the phone. Reading needs an encrypted
desktop snapshot; key recovery for newly provisioned versions can happen first.
No hosted configuration means an explicitly labeled sample
preview with voice disabled; it is not a live mobile release.

On a new phone, sign in with the book's account and select the book. If it has no
key for this device, the opening screen offers **Unlock this book on your phone**
without requiring a previously downloaded snapshot. Enter the desktop recovery
key and its current version. Newly provisioned keys have an immutable, fixed
AES-GCM verifier; the app authenticates its exact book/version and plaintext
locally before guarded encrypted key storage. Only an explicitly absent legacy
verifier permits the existing authenticated manifest proof. A failed/unavailable
verifier does not fall back to another witness. A legacy book with neither proof
needs a snapshot with its existing key or an explicitly reviewed desktop
rotation. Rotation restores future key access and cannot recover historical
ciphertext or pending captures encrypted with a missing old key. Wrong
keys/versions preserve existing local keys. Keep recovery keys private,
outside chat/email. This is the current first-use recovery flow, not QR pairing
or automatic device-to-device key distribution.

Browser keys and local records are encrypted in IndexedDB using a non-exportable
origin-scoped wrapping key. This is not an OS keychain and does not protect
against scripts running on that origin. Clearing site data deletes unsynced work.
The service worker caches application files only, never API/auth responses or
project data. Updates wait for old app windows to close to avoid interrupting
active voice sessions. Keep older hashed assets available during deployments.

Local evidence: browser reading/capture/review/sign-out, offline shell and
downloaded-book reopening with expired credentials, encrypted persistence and
concurrent-tab tests, plus voice transport regressions. Hosted end-to-end voice
and physical iOS/Android audio remain unverified. See `release-checklist.md`.

Enrollment now saves a canonical private identity before the first registration
request, so a lost response or metadata-write failure can retry unchanged after
restart. Browser tabs arbitrate identity creation in an encrypted IndexedDB
transaction; native adapters serialize creation in their single JS runtime and
use SecureStore. Corrupt saved identities fail closed. Normal sign-out retains
encrypted work; signing in as a different user no longer silently deletes it.
Return to the original account to sync or explicitly remove that device's data.

The Review tab decrypts saved captures locally after checking their project,
device, key version, authenticated encryption, digests, and payload identity.
Readable text is held only for display; no plaintext preview is written to
storage. An unreadable capture gets a content-free warning while its encrypted
copy is retained. Uploading removes an item from the local pending list, but does
not mean desktop has imported, accepted, or applied it. Open desktop to review.

### Downloaded books and offline use

Sign in online and open a published book once to download it. Choose **Use
downloaded books** in Projects before disconnecting. This choice persists across
restarts; the app can read scenes and save encrypted captures without creating
an auth client, refreshing an expired token, or contacting hosting. If connection
restoration stalls, **Open downloaded books** is also available on the connecting
and sign-in screens. Only books previously downloaded by this account and device
are available. Titles and library metadata are encrypted, not a plaintext index.

Use **Reconnect to online library** in the downloaded library to refresh and
verify the hosted session. Voice, upload and key recovery stay blocked until you
reconnect. Captures retain the revision you were actually reading, so desktop
can flag stale work. Reconnecting does not upload captures automatically.

Signing out persists a local-access lock and clears this deployment's saved auth
records, including when disconnected. It retains encrypted books, project keys
and pending captures; a fresh online sign-in to the same account unlocks them.
Downloaded-mode sign-out does not attempt remote revocation. Online sign-out
uses Supabase's [current-session scope](https://supabase.com/docs/reference/javascript/auth-signout),
not the default all-device sign-out. Device revocation/removal is a separate
action. Remote access changes cannot erase an offline copy; use a trusted device
and explicitly remove local data when necessary. The local-access record is never
accepted as authorization by the gateway or sync backend.

The expired-session/offline/sign-out/reconnect flow is verified in a phone-sized
Chrome PWA test with simulated hosting. Physical Safari/Android, storage eviction,
signed native auth-storage migration and full revocation drills remain release gates.

Native secure storage can become unavailable after removal, restore, or device
security changes; recovery keys remain important. See [Expo SecureStore storage
limits and persistence](https://docs.expo.dev/versions/latest/sdk/securestore/).
Browser writes request [strict IndexedDB durability](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction),
but cannot prevent user deletion or browser storage eviction.

### Reading position and unfinished captures

Hosted books now restore the last reading scene, scroll position, passive tab,
and unfinished capture text/type after reopening the book in a fresh app
instance. These records use the existing device-encrypted snapshot cache,
separately from downloaded publications, and are bound to the deployment,
account, device, key identity, and book. They are never sent to hosting. A new
publication keeps scene focus but resets the old pixel position; an unfinished
capture keeps its original revision for desktop review.

Wait for **Reading position and capture draft saved on this device** before
closing the app. While a write is pending, an immediate process exit can lose
those newest changes. An encryption/quota failure keeps the current draft,
shows that restart recovery is not saved, and offers retry. Leaving the book
waits for durable recovery; saving a pending item persists its operation identity
before the outbox write, so a restart between outbox commit and draft clearing
can retry without duplicating the capture. Unreadable recovery is retained and
never silently replaced; reading stays available while capture restoration is
retried. Sample preview captures still disappear on reload.

Normal sign-out locks and redacts the local view while retaining encrypted
recovery. Other browser windows receive a content-free lock signal and redact
their views too; foreground entry rechecks device-local authorization. Device
removal also deletes recovery records. Clearing site data, storage eviction or
loss of device keys can still make unsynced work unavailable.

Native snapshot, auth and recovery ciphertext now commit atomically in the
existing SQLite outbox database using WAL and FULL synchronization. Old snapshot
files are decrypted/validated and migrated before removal. Migration uses a
conditional insert; a newer concurrent SQLite publication wins and is decrypted
before the legacy file is removed. If a refresh removes the old file during
reading, the reader rechecks SQLite. This avoids Expo's
overwrite-move behavior deleting the old file before replacement. Real SQLite
process-exit tests verify both rollback before commit and durability after commit.
The database holds ciphertext and hashed record identities; wrapping keys remain
in SecureStore. This does not establish device power-loss or storage-controller
behavior.

Native Supabase sign-in sessions now use the existing encrypted cache, with the
wrapping key in SecureStore. Large tokens never go into new plaintext SQLite
records or a size-limited SecureStore value. Upgrade reads legacy SQLite auth
only to encrypt it, verify decrypt/readback, then remove that plaintext key.
Migration/encryption failures preserve recoverable old data and report failure;
they do not fall back from a corrupt encrypted session to plaintext. Auth writes
and native wrapping-key creation serialize across instances in one JS runtime.
Closing sign-in storage fences late SDK refresh writes. Browser leases compare
a content-free generation and write ciphertext in the same IndexedDB transaction,
including across tabs; native adapter generations share the serialized auth queue.
Offline sign-out makes no logout request. The runtime disposes its old SDK client,
and a deliberate new sign-in waits for cleanup before creating a fresh lease.
The migration protocol is locally tested; signed physical-device upgrade,
Keychain/Keystore failure and power-loss verification remain release gates.

See [reading/capture recovery evidence](evidence/2026-10-02-reading-capture-recovery/review.md).

### Local encrypted round-trip verification

`make test-mobile-hosted-e2e` builds the real app against test-only backend
origins in `.expo/hosted-e2e`. Playwright simulates HTTP auth/storage/RPC responses;
it does not bypass the production runtime or contact a deployed backend. The
real Python engine creates an original fixture book, desktop encryption
publishes it, and the browser recovers from interrupted registration, rejects a
wrong recovery key, opens/reopens the book, and uploads encrypted capture. It
also reopens the saved Review queue, checks ciphertext-only persistence, and
rejects a test-corrupted AES payload even after its public checksum is updated.
The original test envelope is restored normally afterward. With the real service
worker active, it expires the stored auth session, disables network access, reads
the downloaded book, saves/reopens another capture, verifies no hosted requests
while in downloaded mode, reconnects through a real SDK token refresh, signs out
offline, verifies the durable access lock and auth-record cleanup, then signs in
again. The desktop decrypts/imports both captures into its actual inbox; the test asserts
that manuscript prose remains unchanged and no recovery key or captured text
appears in RPC bodies. This is not evidence of deployed RLS or live voice.

The test also rejects backend requests at the HTTP fixture while disconnected.
Installed Chrome 152 resets `navigator.onLine` after reload under offline
emulation (also reproduced on a blank page); the persisted downloaded mode keeps
local use independent of that hint. It does not replace the browser network
property or bypass production auth code to make the test pass.

Exports clear Metro's transform cache so changed public hosting settings are
not silently replaced by a previously cached preview configuration. Test builds
stay separate from `dist`. The ordinary preview/offline test remains
`make test-mobile-e2e`.

## Local development

1. Copy `.env.example` to `.env.local` and configure Supabase plus the Session Gateway.
2. Install dependencies with `npm ci`.
3. Build a native development client with `npx expo run:ios` or `npx expo run:android`.
4. Start Metro with `npm start`.

Expo Go cannot run this app because WebRTC, libsodium, SecureStore, and SQLCipher require native modules. If hosted variables are absent, the shell opens in clearly labeled preview mode; voice and cloud sync stay disabled.

## Trust boundaries

- Realtime SDP is negotiated through the Session Gateway. The mobile app never receives an OpenAI API key.
- Device private keys and unwrapped project keys are stored in platform secure storage.
- Snapshot cache files are encrypted at rest. The hosted snapshot object and outbox contain ciphertext only.
- Read tools execute against the immutable local `SnapshotProject` adapter.
- Write-like assistant actions become immutable pending outbox items for desktop review.
- Microphone use is foreground-only and stops when the app becomes inactive.

## Checks

From the repository root, `make install-js` installs all packages from lockfiles;
`make test-all` and `make js-audit` verify the shared desktop/mobile development
baseline. Use Node 22 via `.nvmrc`.

```sh
npm run check
npm run doctor
npx expo config --type public
```

A store candidate also requires signed iOS and Android builds, the physical-device audio matrix in `release-checklist.md`, hosted RLS tests, privacy disclosures, and human accessibility review.

### Native build dependency override

`xcode@3` still requests `uuid@7`. Its only UUID call is the CommonJS `v4()`
interface. The scoped override selects `uuid@11.1.1`, which retains that interface
and fixes [GHSA-w5hq-g745-h8pq](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq).
`test/nativeBuildCompatibility.test.mjs` exercises Xcode parsing, identifier
generation and serialization against the installed dependency graph. Remove the
override when an upstream Xcode dependency supplies a patched version itself.

### Current export security gate

The mobile lockfile installs `@openauthor/braces@3.0.3-openauthor.1` and
`@openauthor/node-forge@1.4.0-openauthor.1` as regular package files under the
upstream import names. These are modified repository distributions, with exact
upstream archive provenance, preserved licenses and offline reproducible
tarballs under `security/`. Root file dependencies and `$braces`/`$node-forge`
overrides make every transitive caller resolve these distributions. The rest of
the pinned dependency graph is unchanged. Neither advisory has an upstream
patched release as of October 4, 2026.

With npm lifecycle scripts enabled, `npm ci` verifies the fork archives and
applies the repository's byte-bound embedded Braces repairs. Run
`npm run security:forks`, `npm run security:forge` and
`npm run security:braces` to verify delivery and installed bytes. Supported npm Expo commands refuse
unpatched or unexpected verifier, parser, caller, dependency-lock or package-copy
bytes. Dependency updates require review of `security/forge-backport-1.4.0.json`
and `security/braces-backport-3.0.3.json`; the guards never accept new bytes
themselves. Direct guarded export/preflight entry points check both before
loading Expo tooling.

The pinned Node/lib PKCS#1 v1.5 verifier requires complete, canonical DER
DigestInfo values and empty NULL parameter content. Valid SHA algorithm
identifiers with absent or NULL parameters remain supported. Older BER-only
DigestInfo encodings are refused; PSS and NONE verification remain separate.
The Forge distribution omits the six old minified browser bundles/maps and the
obsolete Flash binary. Its Node/CommonJS implementation contains the reviewed
fix. Global/cloud EAS tooling, signing activation, browser signing and signed
native artifacts require separate review and acceptance.
Direct Expo commands and disabled npm lifecycle scripts require separate
verification.

The Braces mitigation covers the modified standalone fork and the seven
Braces modules embedded in `resolve-workspace-root@2.0.1` and
`expo-doctor@1.20.4`. Readable CommonJS sources, original compatibility material,
whole package inventories, exact embedded module entries and surrounding bundle
bytes are pinned. Each file replacement is atomic; a stopped apply can leave a
mix of exact original and patched files. Repeating
`node scripts/braces-backport.mjs apply` completes a recognized mix;
`security:braces` refuses it until every target is patched. Unknown bytes,
missing/duplicate/aliased copies, changed callers or symlinked relevant content
refuse inspection before any replacement. This is per-file recovery, not an
atomic transaction across all targets or automatic cleanup of temporary files
left by process termination.

The maintained Braces sources default and cap `maxDepth` at 100 across public
entry points. Supplied limits must be safe nonnegative integers; zero disallows
container nesting and larger limits are capped. Combined brace/parenthesis
nesting and plain-data AST child paths are checked before recursive walkers;
every child path is limited to `maxDepth + 1` edges. Parent ancestry has a
separate 102-node bound, allowing a shallow subtree to retain finite original
ancestors. Validation rejects child, parent and queue cycles, non-scalar values
and coercible array/object counts before expansion mutates the AST. Shared
subtrees, stale imbalanced parent links and legacy nonbrace numeric metadata
remain supported. Queue flattening and append use iterative traversal. The
10,000-character input ceiling applies independently of `maxLength`;
`rangeLimit` controls remain. Arbitrary JavaScript getters/proxies, custom
transforms and combinatorial expansion output are outside this bounded stack
mitigation. Current ordinary Metro and workspace matching uses Picomatch;
that reachability does not remove the requirement to repair all supplied Braces
copies. The upstream
[Braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) remains
open. This repository distribution does not certify global/cloud
EAS tooling, actual devices or signed native artifacts. Direct Expo/Doctor
commands and disabled lifecycle scripts require explicit guard checks.

`npm run build:web` and `npm run build:test-hosted` run the build-security guard
before exporting. `npm run build:security` checks the fully resolved production
dotenv/config-plugin configuration offline. Use `npm run build:export --
--platform all --output-dir .expo/release-inspection` for a guarded all-platform
Metro export.

The installed Expo signing tooling resolves the reviewed Forge fork. The
upstream [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
remains open. Signing activation is a separate gate: the guard refuses configuration of
`updates.codeSigningCertificate`, `updates.codeSigningMetadata` or an EAS project
ID, including values supplied by dynamic config and plugins. The EAS ID also
enables Expo-root development-signing branches, so this check intentionally
blocks newly linking an EAS project. These configuration checks change no
signing settings.

The guard verifies the three inspected installed signing-header branches return
without network access, then inspects source maps for every exported Metro
bundle and requested platform. Forge, the certificate helper or Expo signing
modules make the export fail. A successful export records bundle/map hashes and
module counts in `security-build.json`; maps are removed before PWA asset
caching. This contains the currently unused tooling path. Raw `npm audit`
remains mandatory at the same threshold. The scoped fork identities have no
upstream advisory records, so a clean registry audit cannot establish their
safety. Archive integrity, whole installed package inventories, original and
fork alias/copy detection, caller resolution and the adversarial tests remain
independent mandatory gates. Neither guard claims to have run the raw audit.

Run `python3 scripts/package-security-forks.py check` from `mobile/` to reproduce
and byte-compare both distributions offline against their pinned upstream
archives and maintained patches. The upstream tarballs are diagnostic/source
material and are never installed. See
[`security/forks.json`](security/forks.json),
[`security/braces-fork.md`](security/braces-fork.md) and
[`security/forge-fork.md`](security/forge-fork.md). Replace these forks when a
reviewed upstream release passes the same regressions. Direct Expo
commands bypass this wrapper; native signing, EAS services and store artifacts
require their separate release checks. See the
[export-containment verification](../docs/evaluations/mobile-build-security-2026-10-02/README.md).
