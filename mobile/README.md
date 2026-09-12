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
allowed browser origin, and publish an encrypted desktop project snapshot before
enrolling the phone. No hosted configuration means an explicitly labeled sample
preview with voice disabled; it is not a live mobile release.

On a new phone, sign in with the book's account and select the book. If it has no
key for this device, the opening screen offers **Unlock this book on your phone**
without requiring a previously downloaded snapshot. Enter the desktop recovery
key and its version. The app verifies the key by decrypting that book's hosted
manifest locally before saving it. Wrong keys/versions do not replace local
keys; a snapshot must first be published on desktop. Keep recovery keys private,
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
native auth-storage hardening and full revocation drills remain release gates.

Native secure storage can become unavailable after removal, restore, or device
security changes; recovery keys remain important. See [Expo SecureStore storage
limits and persistence](https://docs.expo.dev/versions/latest/sdk/securestore/).
Browser writes request [strict IndexedDB durability](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction),
but cannot prevent user deletion or browser storage eviction.

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
