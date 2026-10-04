# Voice preflight and paired-phone test

Status: local browser checks complete; physical audio and deployed integration
are unverified. The phone remains a reading, discussion and capture companion,
not a manuscript editor.

## What was exercised locally

`mobile/e2e/voiceControls.ts`, called by the existing hosted-companion journey,
uses the rendered app, hosted runtime, context builder and voice controller.
Only microphone/WebRTC and hosted HTTP boundaries are simulated. No audio was
recorded, no OpenAI voice call was made, and hosting was not deployed.

- Denied microphone permission leaves Start available without negotiating.
- Cancelling a pending permission request stops a subsequently granted track.
- Story reference context, including the approved Writing Voice, is sent before
  the track is enabled.
- Mute/unmute changes the track, typed messages reach the conversation, and
  Interrupt sends both response cancellation and playback-buffer clearing.
- Disconnect and rejected browser playback stop tracks, display an error, and
  permit starting a new session.
- Leaving Assistant and simulated browser backgrounding stop the tracks; returning
  does not automatically restart microphone capture.

The reproduction-first diagnosis found one UI lifecycle defect: the transport
closed the media, but Assistant retained its old session handle and continued
showing controls for the dead session. Assistant now releases that handle on
terminal disconnect/playback errors while preserving the error. Recoverable
provider errors are not treated as terminal. The regression failed before the
fix and passes afterward. Playback instructions now match the available Start
button. No transport replacement or new infrastructure was needed.

Validation this pass: mobile typecheck and 96 tests; gateway typecheck, 28 tests
and build; 15 desktop voice tests; nine offline writing-evaluation tests; all five
mobile browser journeys (four preview, one hosted including the new voice
scenarios); and the PWA production build. Repository and whitespace checks pass.
The generated browser screenshot is a simulated session, not
evidence of audible speech. Native binaries, Bluetooth and actual interruption
timing were not exercised.

Expo Doctor passed 20/21 checks. Its remaining check flags patch-version lag:
`@expo/metro-runtime` 57.0.15 → 57.0.16, `expo` 57.0.18 → 57.0.24,
`expo-crypto` 57.0.2 → 57.0.3, `expo-dev-client` 57.0.16 → 57.0.19,
`expo-file-system` 57.0.6 → 57.0.7, `expo-network` 57.0.1 → 57.0.2,
`expo-secure-store` 57.0.2 → 57.0.4, `expo-sqlite` 57.0.2 → 57.0.3.
No dependency updates were bundled into this behavioral repair. Align and rerun
the checks before a signed native build. Existing Doctor metadata exclusions for
WebRTC/libsodium do not prove New Architecture compatibility.

## Setup required before the paired test

1. Choose the first device: iPhone Safari/home-screen or Android Chrome/installed
   PWA. Start with one browser; native packaging is a separate gate.
2. Confirm an approved HTTPS companion URL and configured hosted backend/gateway.
   No live connection configuration was found in the inspected checkout `.env`
   files or process environment. Local fixture URLs are not phone-ready links.
   Configure/deploy only with the owner's approval; do not expose local servers
   or install Tailscale implicitly. The proposed desktop-backed connection is an
   option, not the connection exercised here.
3. Use an original disposable book, publish its encrypted snapshot, enroll the
   phone and unlock that book. Verify device authorization in the real deployment;
   the local HTTP fixture does not validate deployed RLS or token hooks.
4. Agree separately on live voice access and a spending limit. The current voice
   gateway uses `OPENAI_API_KEY`; the app's working Codex subscription connector
   is for text generation, not this voice transport. Until authorized, keep live
   voice off. We can still review writing samples and, once hosting is ready,
   test reading/capture without making voice calls. OpenAI documents these as
   distinct [subscription and API authentication paths](https://learn.chatgpt.com/docs/auth).

Keep credentials and recovery keys out of chat, screenshots and test logs.

## Guided acceptance pass — after setup

Record device/OS/browser, browser versus installed mode, network and build revision.
Each item is **not run** until observed on the phone; record pass/fail plus what
happened, not just whether a button responded.

1. Open the original test book. Check chapter order, reader navigation and
   **Discuss this scene**. Confirm the selected scene and Writing Voice.
2. Deny microphone permission. Confirm an understandable error and no active
   microphone indicator. Restore permission through browser settings if needed.
3. Start and speak a scene-specific question. Verify audible reply, relevant
   context and readable transcript. Note perceived delay and any wrong facts.
4. Mute and unmute; interrupt an answer. Verify actual sound stops, not only the
   displayed status. Try the speaker first, then an available headset.
5. Leave Assistant, background/lock the phone, and return. Verify the OS microphone
   indicator clears, playback stops, and a new explicit Start is required.
6. Drop/change the network during a session. Confirm cleanup, an actionable error
   and a successful fresh session after connectivity returns.
7. End voice. Save a capture offline, reopen it, reconnect and return it to the
   desktop review queue. Verify no manuscript prose changes without approval.

The first pass is a smoke test, not the entire
[mobile release matrix](../../mobile/release-checklist.md). Real auth/RLS,
storage eviction, session expiry, accessibility, multiple OS versions and native
builds remain explicit release gates.

## Paired writing review — available now, no setup/spend

Open the [anonymous Luna packet](writing-voice-luna-2026-09-22/review.md) before
the direction key or assistant assessment. For each scene choose source, A, B,
C, tie or none, and explain what improved or changed the story. Prioritize
physical staging, invented ending beats, character distinction and restraint.
Your assessment is not prefilled by the assistant's separate critique.
