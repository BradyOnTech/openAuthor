# Supabase desktop SDK migration review

No actionable SDK compatibility regression found for the reviewed dependency
head. All six Supabase SDK packages move together from 2.112.4 to 2.117.2; their
Node >=22 requirement is unchanged. The desktop creates the SDK in
`cloud/account.ts` for auth, signed claims and RPC. Project registry and mobile
sync/storage use their own fetch transports; voice uses the application's WebRTC
transport. There are no Supabase SDK realtime channel calls.

The relevant upstream change makes a failed competing refresh read a valid
winning session from storage. Empty/expired storage still fails closed. The
wrapper continues verifying the returned token's signature, account, role,
expiry and expected device. Initial-session discard logging is also corrected.
The added passkey, MFA, OpenAPI, realtime wait and storage-versioning APIs are
outside current app usage. The installed Auth/Supabase client sources match the
exact official tag. [Auth changelog](https://github.com/supabase/supabase-js/blob/v2.117.2/packages/core/auth-js/CHANGELOG.md),
[refresh race fix](https://github.com/supabase/supabase-js/pull/2698/files).

Existing focused cloud/enrollment/deletion/recovery units passed 96/96 using
Node 24.19.0. Their SDK replies are synthetic, so a temporary protocol harness
also exercised the actual installed SDK with the unchanged companion-account
and hashed asynchronous auth-storage adapters. The five checks cover signed
ES256 password sign-in and claims, same-identity refresh/local sign-out and RPC
refusal shape, winning-token refresh storage recovery plus subsequent RPC
bearer, cleared-storage fail-closed behavior, wrong-device rejection and forged
signature rejection. The upgraded SDK passed all five. The identical harness
against 2.112.4 failed only the winning-refresh recovery case, matching the
upstream defect; its other four checks passed.

This is local protocol evidence using synthetic fetch responses and a memory
secret store. It does not claim hosted Supabase, native Keychain or actual
cross-window BroadcastChannel acceptance. The first harness attempt falsely
failed logout by JSON-parsing its empty POST; that fixture error was corrected
and is retained as a clearly named diagnostic log. No repository source,
dependencies, app settings or hosted service state were changed by this review.
