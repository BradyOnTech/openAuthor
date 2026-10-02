# Mobile recovery before first publication

Baseline: `2ed7f6da2497312d7a52f8734cff550a72dcf9e7`. Local source freeze:
October 2, 2026. Spec: [book key recovery](../../../docs/no-snapshot-key-recovery.md).
The separate root integration packet owns desktop, database and gateway evidence.

The enrolled mobile project listing reaches the existing recovery form before a
snapshot exists. The candidate OA1 key authenticates an immutable provisioned
AES-GCM verifier locally, including exact project/version/AAD, ciphertext digest
and fixed plaintext. Only positively null legacy verification permits the
existing encrypted manifest proof. Unknown, stale, malformed or invalid proofs
refuse; no candidate-driven backfill is attempted. Reading still requires explicit
desktop snapshot publication. Rotation cannot restore unavailable old ciphertext.

## Observed results

- TypeScript and **243/243 tests in 34 files** pass. Tests exercise the installed
  Expo AES public wrapper and web adapter with actual WebCrypto, encrypted
  IndexedDB through independent store instances, and native SecureStore/SQLite
  adapters through deterministic OS ports.
- Actual installed Chrome passes **2/2 App journeys**, including original
  encrypted reading/capture/desktop return, offline retention/cold restart and
  no-snapshot recovery. Actual WebKit passes the **1/1 no-snapshot recovery App
  journey**. Both use `index-49c4913ae4c7a7a9703a57d7e8182046.js`.
- The App journey checks wrong checksum-valid key rejection, accepted current
  key and encrypted device-slot retention after reload, absent manuscript
  download, explicit unpublished status, and actual installed Supabase SDK
  session replacement both while the form is open and during paused proof.
  Replacement redacts the old title/OA1 form and no late proof stores a key.
- Final native key and explicit local-authorization OS-write controls restore
  their prior key/index or access lock after a changed scope. Browser controls
  also cover closure after IDB transaction commit and preserve superseding keys
  or replacement devices using ciphertext CAS. Downloaded entry waits for known
  closure cleanup; deliberate sign-in alone reauthorizes. Downloaded mode retires
  its online SDK observer so a later SDK sign-out does not revoke offline access.
- All **150 captured mobile/contracts/installed crypto/Auth inputs** remain
  unchanged before and after final checks. `tested-inputs.json` and its archive
  identify exact bytes; `results.json` records counts. `verify.py` checks current
  inputs and this packet's evidence hashes.

## Failure evidence and provenance

Raw original output is retained, compressed without editorial changes, under
`logs/`. `historical-hosted-recovery-red` records three failures before the new
proof path; `historical-positive-ack-ui-red` caught acknowledgement disappearing
after the opening retry and led to parent-owned positive UI state. The initial
missing-module red only establishes missing implementation. The storage red
includes one actual native scope fence failure and one incorrect test closure
that was fixed; the latter is not a product defect. The transient voice monitor
regression is retained and fixed in the final 243-test run.

`negative-controls/late-key-write` contains the exact mutated fixture and metadata
for a **retrospective** post-write-fence-disabled run: two native final key writes
and three browser post-commit windows fail (**5 failures, 20 passes**). The separate
`local-authorization` fixture removes only the final native access-write check and
browser post-commit check/rollback; the two selected access-write regressions fail
(**2 failures, 15 deliberately deselected**). These controlled negatives are not
represented as historical pre-fix runs. Their guards prevent accepted late
completion and surviving late candidates; native writes already dispatched to
the OS cannot be canceled and are restored while the local queue remains held.

The earlier full WebKit attempt is retained as a synthetic service-worker route
interception/DNS limitation. Its no-snapshot fixture now blocks service workers;
the final selected WebKit journey passes. Chrome's original cold-restart journey
keeps its service-worker coverage. A missing Playwright Chrome executable attempt
is also retained; the successful run uses installed Google Chrome. No dependencies
were installed or changed.

## Acceptance boundaries

HTTP Auth/RPC/Storage and voice provider boundaries in App journeys are synthetic.
Native ports prove JS-runtime queue/rollback behavior; they do not certify OS
Keychain, physical phones, multiple native runtimes or signed application behavior.
Deployed authorization, physical iOS/Android, live audio/provider cleanup,
signing/notarization and clean-machine acceptance remain separate gates. No author
manuscript, provider account, deployed service or release artifact was modified.

The browser screenshots were inspected at the mobile viewport: the positive
state says publication is still required; the replacement state returns to the
locked sign-in page with no previous title or recovery input. Actual journey
clicks reach the scrollable recovery controls and assert no horizontal overflow.
