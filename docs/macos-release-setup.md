# macOS release setup

The arm64 and Intel build workflows are configured. Apple credentials must come from the account owner; no signing identity or repository secrets were present at the September 28 check. Do not put credentials in chat, Git, or evaluation reports.

**Your one-time Apple step**

If you already have a Developer ID Application certificate, export it with its private key as a password-protected `.p12` using Keychain Access. Otherwise the Apple Developer account holder must create it first. Use the outside-the-App-Store certificate, not a development certificate. Follow [Apple's Developer ID instructions](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/).

You also need your Team ID and an Apple app-specific password for notarization, not your normal account password. This matches the [Tauri signing and notarization setup](https://v2.tauri.app/distribute/sign/macos/).

**Secure configuration**

Run this yourself in a terminal from the repository:

```sh
bash scripts/configure_macos_release.sh --configure
```

The helper confirms the private destination, asks before replacing secret values, uploads only the certificate you select, and uses GitHub CLI's hidden prompts for the remaining values. It never reads the keychain or prints credential values. It does not start a release. An interrupted setup may leave some secrets configured; rerun it to finish. Existing secrets cannot be recovered from GitHub after replacement.

Alternatively use [repository Actions secrets](https://github.com/BradyOnTech/openAuthor/settings/secrets/actions). The existing release workflow expects exactly these fields:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded exported `.p12`, including private key |
| `APPLE_CERTIFICATE_PASSWORD` | Password chosen for that export |
| `APPLE_SIGNING_IDENTITY` | Full Developer ID Application identity |
| `APPLE_ID` | Apple Developer account email |
| `APPLE_PASSWORD` | Apple app-specific password |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

**What happens next**

After the owner confirms configuration, inspect names only, run the signed workflow on the approved branch, and verify signing and notarization for both architectures. The workflow creates a draft prerelease, not a public release. Do not publish it or merge the PR without authorization. Secret presence alone does not establish that the credentials work.

Fresh GitHub runners verify packaged code, not a person's installation experience. Clean-machine checks must still download the signed artifact normally, pass Gatekeeper without bypassing warnings, launch the GUI, exercise synthetic writing/apply/undo/backup/recovery, and record machine architecture, OS version, build SHA, and results. An upgrade from a published signed release cannot be claimed before one exists.

**October 2 local and CI hardening**

The local identity check found zero valid signing identities. A read-only
repository-secret-name query using the existing repository-owner credential
returned no Actions secrets; it did not switch accounts or retrieve secret
values. Apple signing/notarization configuration is still an owner-supplied gate.

Unsigned packaging now installs both shared contracts and desktop dependencies
from their lockfiles and runs on both native architectures. Signed packaging
runs repository, core, shared-contract, desktop and native checks before building.
The bundle verifier checks exact installed Python source against the reviewed
checkout, application identity/version, and the architecture of the application,
Python, Codex and embedded Git. Signed verification additionally requires a
Developer ID Application authority, hardened runtime, a valid stapled notarization
ticket and Gatekeeper acceptance. These requirements are configured checks;
they have not been passed with Apple credentials in this checkout.

The packaged engine recovery probe runs with system tools absent from PATH.
It now kills real packaged-Python child processes with SIGKILL after a first
scene, Revision HEAD and proposal write, immediately before the commit marker,
and after the marker. The first normal read must restore exact original bytes
or preserve a completed commit; coordinated undo must then restore the originals.
This does not exercise WebView storage, GUI focus, microphone permission,
Keychain access under a Developer ID identity or physical power loss.

CI retains a per-architecture evidence JSON with the core source digest, commit,
checkout-clean status, runtime manifests, binary hashes and architecture checks.
Distributable archive/DMG SHA-256 files accompany those reports. A local dirty
checkout's digest identifies its actual core bytes; its commit alone does not
identify the uncommitted source. The report always leaves release certification
false and manual acceptance gates unobserved.

Before certifying either architecture, record the downloaded artifact's checksum,
OS/architecture, build identity and observed outcomes for:

- Normal Gatekeeper installation and first launch without developer tools.
- Import, reviewed revision, partial acceptance, exact undo, Storyline navigation,
  export, portable backup and restore through the packaged GUI.
- Forced termination with unfinished writing and pending multi-file Changes;
  restart must recover or expose an explicit comparison without losing new work.
- VoiceOver and keyboard traversal, meaningful control names, focus restoration,
  light/dark contrast, text scaling and error/recovery states.
- An upgrade preserving projects, credentials and drafts from a previously
  released signed version, when such a version exists.

Store this evidence beside the CI report. Green build evidence alone does not
turn these manual entries into passed results.

**Sources**

- [Apple Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
- [Tauri macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
