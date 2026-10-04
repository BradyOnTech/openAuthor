# Trusted and lost companion devices

The desktop Mobile Inbox now shows the connected account, this desktop's full identity, and each device's platform, account, device key version and book enrollment. Revocation names the exact device and requires a separate confirmation. It affects this book; the current desktop must be revoked from another trusted desktop.

Book-key rotation has its own review and confirmation. The review pins the prior version and exact remaining device/key recipients. The coordinator reads the server's active key state, refuses stale versions, checks the reviewed recipient set before sealing, and relies on the atomic SQL rotation to recheck that set. Revocation retires the current book key. Rotation does not publish automatically: the author must explicitly publish a new snapshot.

Nonsecret version/reason/target/review intent is journaled using the existing durable draft module. Account/device/book scopes keep drafts and delayed outcomes separate. Reopening resets confirmation; a failed mutation requires an explicit successful refresh before another change or sync action. An unchanged initial version is pinned as soon as review begins, so a failed request cannot silently adopt a later server version after navigation. Recovery material stays in memory. Account reset clears entered/displayed recovery material, fences late secrets and callbacks, and restores deliberate Connect without letting an old completion clear a new request's busy state.

Recovery input is verified with an AES-GCM challenge against an independently loaded/provisioned current key. A valid OA1 checksum alone cannot identify the book. A wrong-book key never replaces the verified key; a same-account refusal retains the masked input for correction. When no verified current key exists, this path refuses publication unlock and directs the author to reconnect or review a new rotation. Recovering absent current envelopes through a stronger project-bound commitment or existing snapshot verification remains future work.

The UI states that revocation cannot erase downloaded/decrypted offline copies or undo requests already in progress. Remaining devices need a new key and an explicitly republished snapshot.

## Evidence

`results.json` records the final source hashes and bounded checks. The six focused test files cover stale authority, changed recipients, retired historical keys, current-key recovery verification, old authority reads, duplicate/in-flight operations, failed draft recovery, account reset and delayed old completions. `account-reset-red.txt` demonstrates the stuck Working state before the fix; `recovery-key-red.txt` demonstrates the wrong-book OA1 acceptance before the fix. Their green results and the final focused run are retained separately.

`companion-trusted-devices.spec.ts` renders the production device panel, coordinator, RPC adapter and real libsodium sealed-box provisioning against local synthetic RPC responses. It covers delayed revocation across book navigation, separate confirmed rotation to the remaining device, explicit publication, stale-version refusal, preserved prior-version draft, error acknowledgement and reload without restored consent. `trusted-device-review-laptop.png` shows the recovered draft and reachable controls at 1024 × 768.

This fixture does not authenticate to a real account, mutate hosted devices, exercise a provider or claim a deployed/native device journey. Its simulated server state is rebuilt on browser reload; that checkpoint verifies local draft recovery, not hosted persistence. The separate disposable PostgreSQL suite owns real SQL authority/locking and historical-versus-active-key evidence. Source review of `20261002140000_mobile_active_authority.sql` found no mismatch with the desktop key-state contract. No deployment, live provider call, private author data edit or commit was made in this lane.

`full-before-final-browser.txt`, `build-before-final-browser.txt`, `full-before-account-reset-fix.txt` and `build-before-account-reset-fix.txt` retain earlier successful checkpoints; use the final logs and `results.json` for the final-source result.
