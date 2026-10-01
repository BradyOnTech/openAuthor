# Mobile release checklist

## Browser companion delivery

- [x] Shared companion UI exports to a browser bundle with an install manifest.
- [x] Versioned app-shell cache excludes API, authentication, and project data.
- [x] Browser-local encryption and cross-tab immutable outbox regressions pass.
- [x] Phone-sized Chromium walkthrough covers reading, capture, review, sign-out,
  and offline shell reopening; this is not a physical Safari/Android test.
- [x] Retry interrupted enrollment using a securely persisted identity; cover
  cross-tab creation, metadata-write failures, corruption, and missing keys.
- [x] Offer recovery before a book opens; verify a recovery candidate against
  the selected encrypted manifest before persisting it.
- [x] Local simulated-hosting browser workflow uses a real Python fixture book,
  desktop encryption/import, wrong-key rejection, restart/reopen, and encrypted
  capture return without manuscript mutation. Deployed auth/RLS is not simulated
  evidence of real authorization correctness.
- [x] Read pending captures after a cold browser reopen without persisting
  plaintext previews; reject tampered AES payloads and mismatched identities,
  retain unreadable ciphertext, and distinguish upload from desktop review.
- [ ] Deploy the additive browser-device platform migration and exercise RLS.
- [ ] Publish the PWA over HTTPS with CSP, MIME/security headers, allowed gateway
  origin, and a rollback-safe hashed-asset retention policy.
- [ ] Enroll a real browser device, unlock a published book, and verify encrypted
  capture returns to the desktop review queue without changing prose.
- [ ] Real OpenAI voice on iPhone Safari/home-screen and Android Chrome/installed
  mode: permission denial, cancellation, playback, Bluetooth, interruptions,
  background stop, reconnect, and expired-session behavior.
- [x] Simulated-media rendered-browser checks cover denial, pending-permission
  cancellation, context-before-audio, mute, interruption, disconnect/playback
  retry, tab exit and background cleanup. See the
  [preflight and paired test](../docs/evaluations/2026-09-22-voice-preflight.md);
  this does not check real audio, permissions or physical phone behavior.
- [x] Local phone-sized Chrome PWA test: cold downloaded-book access and capture
  with expired credentials, no hosted requests in downloaded mode, explicit
  verified reconnect, offline sign-out lock/auth cleanup, retained captures and
  same-account sign-in/upload/desktop import. Hosting remains simulated.
- [ ] Verify physical-device offline behavior, browser storage eviction/quota,
  native auth-storage encryption/migration, account-switch and deletion drills,
  concurrent native cache/key creation, and cross-tab sign-out redaction.

## Security and hosted integration

- [ ] Deploy migrations and run `supabase db reset` plus the adversarial RLS suite in the target configuration.
- [ ] Configure a Custom Access Token Hook that signs the enrolled `device_id` claim.
- [ ] Create the private `mobile-encrypted-sync` bucket with object-size/MIME/path RLS.
- [ ] Deploy the Session Gateway with JWKS validation, distributed rate limits, secrets management, audit export, and TLS.
- [ ] Verify key rotation after device revocation and end-to-end account/project deletion.
- [ ] Deploy and drill the trusted deletion worker: list cleanup-manifest paths, delete/verify Storage objects, then delete or transfer project/account metadata.
- [ ] Run dependency, secret, SAST, and mobile binary scans.

## Physical-device voice matrix

- [ ] Verify `react-native-webrtc` and `react-native-libsodium` against Expo 57's New Architecture on signed iOS and Android development builds. React Native Directory does not yet mark either package as tested there; the Expo Doctor exclusion only acknowledges this known metadata warning.
- [ ] Inspect final Android manifests and iOS privacy usage descriptions: microphone/audio permissions present, camera permission absent, and no background audio mode.
- [ ] Current and previous iOS on iPhone: receiver, speaker, wired/Bluetooth route, interruption, lock/background stop, permission denial, reconnect.
- [ ] Current and previous Android on representative Pixel and Samsung devices: speaker, wired/Bluetooth route, audio focus, phone call interruption, permission denial, reconnect.
- [ ] Measure time-to-first-audio, turn latency, barge-in success, packet-loss behavior, thermal load, and battery use on Wi-Fi/LTE/5G.
- [ ] Confirm microphone indicator and foreground-only behavior in every route.

## Product and accessibility

- [ ] VoiceOver and TalkBack traversal, labels, state announcements, focus order, and adjustable text.
- [ ] 44pt/48dp targets, contrast, Reduce Motion, Dynamic Type/font scaling, keyboard avoidance, loading/error/offline/empty states.
- [ ] No mobile action directly mutates manuscript prose; every write-like action appears in desktop review.
- [ ] Citations open the correct snapshot source and visibly show stale revision state.

## Store operations

- [ ] Final app identifiers, icons, splash, support/privacy URLs, age rating, screenshots, and localized listing.
- [ ] Apple privacy manifest/API reasons and App Privacy answers reviewed against the final binary.
- [ ] Google Play Data Safety, foreground microphone disclosure, account deletion URL, and content declarations reviewed.
- [ ] Signed TestFlight and Play internal-track builds pass crash-free and upgrade/migration tests.
- [ ] Recovery, rollback, feature flags, usage/cost alerts, incident owner, and support runbook are live.
