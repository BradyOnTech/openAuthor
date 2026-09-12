# Mobile privacy and data inventory

## Collected and transmitted

| Data | Purpose | Destination | Retention |
| --- | --- | --- | --- |
| Account identifier and access token | Authentication and project authorization | Supabase Auth | Provider/session policy |
| Device label, platform, and public key | Device enrollment and key wrapping | Supabase metadata | Until device revocation/account deletion |
| Encrypted project snapshot bytes and non-content routing metadata | Opt-in cross-device sync | Private object storage and Supabase metadata | Until project/account deletion or lifecycle cleanup |
| Encrypted pending outbox bytes and non-content routing metadata | Deliver captures and review requests to desktop | Supabase metadata | Until import plus retention cleanup |
| Live microphone audio | User-started voice conversation | OpenAI Realtime over WebRTC | Not persisted by openAuthor; provider handling follows the configured API policy |
| Final transcript turns, when project chat retention is enabled | Continue the author’s project conversation | Encrypted outbox, then local desktop project | Project-controlled |

## Kept on device

- Device private key and project keys in SecureStore/Keystore.
- Encrypted project snapshot cache.
- Ciphertext-only pending outbox records and status metadata.

## Explicitly excluded

- No OpenAI permanent API key on device.
- No Supabase service-role key on device.
- No raw audio recording or background microphone capture by openAuthor.
- No direct hosted plaintext manuscript, prompt, transcript, tool argument, or tool result.
- No advertising or cross-app tracking SDK.

Account deletion must revoke devices, delete key envelopes and hosted encrypted objects, remove Auth/workspace metadata under the product retention policy, and clear local secure keys/cache. Signed URLs already issued remain valid until their short expiry, so deletion cannot revoke a URL retroactively.
