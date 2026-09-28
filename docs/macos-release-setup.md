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

**Sources**

- [Apple Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
- [Tauri macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
