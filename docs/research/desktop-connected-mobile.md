# Desktop-connected mobile companion: bounded evaluation

Research date: 2026-09-07 (America/Chicago). Recommendation, not an architecture decision.

## Recommendation and local evidence

Test a narrow desktop context/capture bridge while preserving encrypted downloaded reading and capture. This evaluates a hybrid without replacing sync or committing to hosting. The [approved direction](../product-development-plan.md#approved-working-direction--2026-09-07) keeps manuscript authority and review on desktop and requires a real-phone read/talk/capture/handoff journey.

**Local observations, not external facts:** this working tree is modified beyond HEAD `3fde8c92273a79d2d287ddc049378752ad82e5c1`; these observations concern its current files. [Mobile README](../../mobile/README.md) documents an Expo native/PWA companion, encrypted snapshots/outbox, manual recovery-key enrollment, offline downloaded books and explicit reconnect. It reports browser/real-engine tests with simulated hosting; deployed authorization and physical-phone voice remain unverified. Browser wrapping keys are origin-scoped, not an OS keychain; deletion or eviction can lose unsynced work. These tests were not rerun for this research.

The [voice plan](../voice-mobile-build-plan.md) retains device-local snapshot tools and desktop-reviewed writes. [Gateway documentation](../../gateway/README.md) describes authenticated project/device authorization and SDP negotiation. The existing [`openauthor serve`](../../openauthor/server.py) is a stdin/stdout sidecar, not a ready-made remote HTTP service. A network companion needs a deliberately narrow adapter; forwarding the full sidecar interface would exceed companion scope.

## Verified external precedent

The matching project is **T3 Code, `pingdotgg/t3code`**, linked to `t3.codes` by its [official repository](https://github.com/pingdotgg/t3code). It describes mobile/web/desktop control of agents on a host. This is a strong match to the user's name, but the intended example was not explicitly confirmed. ChatGPT's architecture was not investigated; that analogy remains unverified.

[Pinned T3 remote-access documentation](https://raw.githubusercontent.com/pingdotgg/t3code/b7c002f918b94b8ce13c44bddcd29b8443e4af41/docs/user/remote-access.md), commit `b7c002f…` (2026-09-08 03:14 UTC, September 7 Chicago), documents both managed T3 Connect and direct LAN/tailnet pairing. Its host must remain running and reachable. One-time pairing authorizes subsequent device connections; unused-link revocation and existing-session revocation are separate. Tailscale HTTPS joins both devices to a tailnet and exposes a `ts.net` endpoint. The hosted web client still needs a reachable HTTPS backend. SSH hosts require compatible Node and provider setup. This supports the connection/pairing pattern, not a claim that openAuthor already has it or that T3's product suitability/security has been audited.

## Comparison — engineering assessment

| Dimension | Encrypted snapshots + hosted gateway | Live desktop | Hybrid experiment |
| --- | --- | --- | --- |
| Onboarding | Account, desktop publication, phone enrollment/recovery key; backend setup for operator | Tailscale on both devices, login, grants, HTTPS, app pairing, running bridge | Live pairing plus explicit encrypted download; initially more choices |
| Desktop asleep/offline | Downloaded reading/capture continue; online voice can use snapshot through gateway; new desktop publication/import waits | Live context/tools and desktop-issued voice startup unavailable | Show cached revision and queue captures; suspend live voice if required desktop services disappear |
| Context | Immutable, visibly dated snapshot; narrow mobile tool implementation | Current desktop runtime/context, subject to revision checks | Pin each turn to one source/revision; change mode explicitly |
| Operations | Identity, database/RLS, encrypted storage, gateway uptime, provider quotas | Desktop availability, bridge updates, VPN/TLS support, credentials and quotas | Retains cache/key/outbox complexity plus bridge support |

These are dependency-based expectations, not measured phone reliability or cost results. A standalone live design could avoid hosted snapshot storage and move issuance to desktop; that would require new implementation. Retaining hosted issuance preserves gateway operations. Tailscale currently lists a free Personal tier and paid team tiers; eligibility and product distribution need review, not an assumption of zero operating cost. Provider usage and desktop power/support remain separate costs. [Current pricing](https://tailscale.com/pricing).

## Transport, authorization and voice boundaries

**External facts:** Serve proxies local services privately within the tailnet, applies network access controls and offers HTTPS; Funnel is the public-sharing facility. Serve strips incoming identity headers and supplies trusted user headers, but tagged devices lack user headers. Backends trusting these headers should listen only on localhost. App-capability headers require Tailscale 1.92+. The Serve page was last validated January 20, 2026. [Serve documentation](https://tailscale.com/docs/features/tailscale-serve).

Grants select source, destination and network/application permissions; permissions combine, so a narrow grant does not cancel a broader grant. Check the whole policy and restrict the phone to the companion service. [Grants syntax, validated January 5, 2026](https://tailscale.com/docs/reference/syntax/grants).

**Proposed app contract:** pairing creates a revocable device session with explicit project read/capture permissions. Check it on every request, enforce tool allowlists, validate origins and protect cookie-authenticated writes against CSRF. Network membership or a user header alone must not authorize every book. App capabilities still need application enforcement. Keep provider credentials on the trusted issuer and all manuscript changes in desktop review.

Tailscale's encrypted transport does not make an HTTP origin a browser secure context. Microphone APIs require a secure context and user permission. Use a trusted HTTPS hostname, including the API connection; avoid an HTTPS shell calling an HTTP desktop. HTTPS setup uses MagicDNS/certificates and publishes certificate hostnames in transparency logs, so choose a non-sensitive machine name. [Tailscale HTTPS](https://tailscale.com/docs/how-to/set-up-https-certificates), [W3C Media Capture](https://www.w3.org/TR/mediacapture-streams/). HTTPS alone does not prove Safari microphone, background, Bluetooth or network-handoff behavior.

**Local route versus proposed route:** current [mobile WebRTC transport](../../mobile/src/voice/realtimeTransport.ts) attaches phone audio to the negotiated provider peer; the gateway brokers SDP. Context/tools run against the phone snapshot. In the experiment, phone audio can retain that provider route while context/tool requests travel to the desktop bridge. Moving issuance to desktop is optional additional work. Desktop tools do not make cloud inference local: selected context/tool results still reach the voice provider. Offline capture should initially mean durable text notes; offline speech recognition is not established.

Revocation must separately disable app sessions and network access, deny future snapshot keys/downloads, and address any active provider call. Tailscale removal disconnects the device, but it can rejoin without administrator authorization unless device approval is enabled. [Removal](https://tailscale.com/docs/features/access-control/device-management/how-to/remove), [device approval](https://tailscale.com/docs/features/access-control/device-management/device-approval). Neither network revocation nor key rotation erases previously decrypted offline copies; provider-call termination needs its own test.

## Next experiment and acceptance

Propose a two-day spike with one desktop, one phone and an original fixture book. First build/test only a loopback adapter: health/revision, bounded scene/context reads, and idempotent pending-capture submission. Reuse encrypted cache/outbox semantics. No arbitrary CLI, paths or manuscript-apply endpoint.

A separately authorized device stage would install/configure Tailscale Serve, restrict grants, pair the phone and test HTTPS microphone permission without paid inference. Accept only if unpaired/wrong-project/revoked requests fail; desktop sleep and Wi-Fi/cellular switching show an honest disconnected state; offline cold restart retains reading/capture; reconnect imports each capture once for desktop review; and repeated delivery never changes prose. Record OS/browser/Tailscale versions, onboarding time, reconnect latency and failures. Keep a stable origin to preserve browser storage.

Live scene-aware voice, interruption and provider-session revocation require a later explicit spending cap and physical iOS/Android tests. Compare this journey against the existing snapshot path before choosing architecture. This research installed/exposed/deployed nothing, accessed no private manuscript, and incurred no provider spending.
