#!/usr/bin/env bash
# Run interactively yourself; never paste certificate or password values into chat.
set -euo pipefail

REPOSITORY="BradyOnTech/openAuthor"

if [[ "${1:-}" != "--configure" || $# != 1 ]]; then
  echo "Usage: bash scripts/configure_macos_release.sh --configure"
  echo "Uploads a chosen Developer ID Application .p12 and five prompted values"
  echo "to GitHub Actions repository secrets for $REPOSITORY."
  echo "Requires gh authentication and an existing Apple signing certificate."
  echo "Does not create a certificate, build, tag, merge, or publish a release."
  if [[ "${1:---help}" == "--help" ]]; then exit 0; else exit 2; fi
fi

if [[ ! -t 0 || ! -t 1 ]]; then
  echo "Run this yourself in an interactive terminal so credentials stay out of logs." >&2
  exit 1
fi

command -v gh >/dev/null
command -v openssl >/dev/null
gh auth status
if [[ "$(gh repo view "$REPOSITORY" --json isPrivate --jq .isPrivate)" != "true" ]]; then
  echo "Expected the private $REPOSITORY repository; refusing configuration." >&2
  exit 1
fi

echo "This uploads your signing private key and notarization credentials to $REPOSITORY."
echo "Existing secrets with these names will be replaced. No release is started."
read -r -p "Continue? Type yes: " confirmation
[[ "$confirmation" == "yes" ]] || exit 1
read -r -p "Absolute path to your exported Developer ID Application .p12: " certificate_path
if [[ "$certificate_path" != /* || ! -f "$certificate_path" || ! -r "$certificate_path" || "$certificate_path" != *.p12 ]]; then
  echo "Choose an existing readable .p12 file by its absolute path." >&2
  exit 1
fi

# Encoding is piped directly to gh; no secret appears in command arguments or files.
openssl base64 -A -in "$certificate_path" | gh secret set APPLE_CERTIFICATE --repo "$REPOSITORY"

echo "Next: the password you chose when exporting the .p12."
gh secret set APPLE_CERTIFICATE_PASSWORD --repo "$REPOSITORY"
echo "Next: exact identity, such as Developer ID Application: Your Name (TEAMID)."
gh secret set APPLE_SIGNING_IDENTITY --repo "$REPOSITORY"
echo "Next: your Apple Developer account email."
gh secret set APPLE_ID --repo "$REPOSITORY"
echo "Next: an Apple app-specific password, NOT your main Apple account password."
gh secret set APPLE_PASSWORD --repo "$REPOSITORY"
echo "Next: your Apple Developer Team ID."
gh secret set APPLE_TEAM_ID --repo "$REPOSITORY"

echo "Configured secret names (values are never retrieved):"
gh secret list --repo "$REPOSITORY"
echo "Setup stored. Certificate validity and notarization still require a successful build."
