# Reviewed desktop account deletion

The desktop shows the server-fingerprinted inventory before a request: each
workspace, book, historical deletion request and account device. Shared history
requires acknowledgment, pending captures have an explicit keep/remove choice,
and a sole shared owner must arrange handoff. Account-only enrollment allows an
author with no hosted books to reach the same review without joining a project.

A request immediately blocks publishing, import, recovery and device changes.
A lost reply preserves the pending review and permits status readback; it never
resubmits. Owned status remains readable without an active device. Real account,
Auth-session or device changes redact the review and withhold late results;
same-session refocus preserves reviewed confirmations and uncertain outcomes.

Six rendered journeys pass in Chrome and six in WebKit, including three existing
key-recovery journeys. The new account journeys cover exact laptop scope,
historical metadata absence, individual devices, a lost reply, same-session
refocus, true sign-out during a request, and an empty hosted account. The
companion-account wrapper, enrollment, device-key creation, author RPC client
and panel are production code. SDK identity, Keychain storage and RPC replies are
synthetic boundaries; PostgreSQL authority has separate account/voice evidence.

`verification.json` binds the current source and retained command output. The
laptop screenshot is a synthetic rendered review, not native Keychain or signed
application acceptance. Tests do not delete a real account, contact the provider,
or certify target Storage backing deletion or provider final billing.

```sh
cd desktop
npm test
npm run build
OPENAUTHOR_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm exec -- playwright test e2e/account-deletion.spec.ts e2e/companion-key-recovery.spec.ts --browser=chromium
npm exec -- playwright test e2e/account-deletion.spec.ts e2e/companion-key-recovery.spec.ts --browser=webkit
```
