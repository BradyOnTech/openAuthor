# macOS release setup

Build and verify releases manually on local arm64 and Intel Macs. GitHub Actions and scheduled dependency updates are disabled. Signing credentials stay on the operator's Mac; the repository-secret upload helper has been removed.

**Your one-time Apple step**

Install a valid Developer ID Application certificate and its private key in the local login keychain. If you need a new certificate, follow [Apple's Developer ID instructions](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/).

You also need your Team ID and an Apple app-specific password for notarization, not your normal account password. This matches the [Tauri signing and notarization setup](https://v2.tauri.app/distribute/sign/macos/).

**Local configuration**

Find the installed signing identity:

```sh
security find-identity -v -p codesigning
```

Set these environment variables in the local build session, following [Tauri's local signing and notarization instructions](https://v2.tauri.app/distribute/sign/macos/). Keep the password out of shell history and repository files.

| Environment variable | Value |
| --- | --- |
| `APPLE_SIGNING_IDENTITY` | Full Developer ID Application identity |
| `APPLE_ID` | Apple Developer account email |
| `APPLE_PASSWORD` | Apple app-specific password |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

**Build and verify locally**

From the repository root on each matching Mac:

```sh
source scripts/rust_env.sh
make install-desktop
OPENAUTHOR_RUNTIME_ARCH="$(uname -m)" make runtime-prepare
make check test test-contracts test-desktop tauri-test
make macos-bundle
OPENAUTHOR_REQUIRE_SIGNED_BUNDLE=1 \
  OPENAUTHOR_EXPECT_ARCH="$(uname -m)" \
  OPENAUTHOR_BUNDLE_REPORT_PATH="$PWD/desktop/src-tauri/target/signed-package-evidence.json" \
  make macos-bundle-check
```

The app and DMG are under `desktop/src-tauri/target/release/bundle/`. Record their SHA-256 checksums beside the verification report. Publishing is a separate manual step. A successful build does not establish clean-machine acceptance: download the signed artifact normally, pass Gatekeeper, launch the GUI, exercise writing/apply/undo/backup/recovery, and record architecture, OS version, build SHA, and results. An upgrade from a published signed release cannot be claimed before one exists.

**Verification checks and historical October 2 checkpoint**

The local identity check found zero valid signing identities. A read-only
repository-secret-name query returned no Actions secrets. This describes the
October 2 inspection; release configuration now uses the local keychain and
local environment. Apple signing/notarization remains unverified.

Local packaging installs shared contracts and desktop dependencies from their
lockfiles. Repeat the build on each native architecture. Signed packaging uses
the repository, core, shared-contract, desktop and native checks above.
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

The local bundle verifier writes an evidence JSON with the core source digest, commit,
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

Store this evidence beside the local bundle report. Green build evidence alone does not
turn these manual entries into passed results.

**Sources**

- [Apple Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
- [Tauri macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
