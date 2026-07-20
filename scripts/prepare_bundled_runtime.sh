#!/usr/bin/env bash
set -euo pipefail

# macOS does not provide the Linux-style C.UTF-8 locale that some shells export.
export LANG="en_US.UTF-8"
export LC_ALL="en_US.UTF-8"
export LC_CTYPE="en_US.UTF-8"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/desktop/src-tauri/resources/runtime/python"
CODEX_DEST="$ROOT/desktop/src-tauri/resources/runtime/codex"
RELEASE="20260510"
PYTHON_VERSION="3.11.15"
CODEX_VERSION="0.144.6"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The current release runtime builder supports macOS only." >&2
  exit 1
fi

case "${OPENAUTHOR_RUNTIME_ARCH:-$(uname -m)}" in
  arm64|aarch64)
    ARCHIVE_ARCH="aarch64"
    EXPECTED_SHA256="03bcedae9b19a48888d7dc8ba064f73f6efaaf2b13f6a8e1a1bcc062df13e855"
    CODEX_NPM_ARCH="darwin-arm64"
    CODEX_TARGET="aarch64-apple-darwin"
    CODEX_EXPECTED_SHA512="eb382f87bd0ccc1352793d7b1c48523ab9a618664600acd20bbc7a240abe79d90991d3d803d3f4235b46eda278f46941901c6e0be30a047d6a9bafb60a085cc3"
    ;;
  x86_64|amd64)
    ARCHIVE_ARCH="x86_64"
    EXPECTED_SHA256="5e388e3db8b59c8487ddd1423330b90fc7f0c6ef7eadec945441a180d0dd4bc4"
    CODEX_NPM_ARCH="darwin-x64"
    CODEX_TARGET="x86_64-apple-darwin"
    CODEX_EXPECTED_SHA512="4c74723c6d33494e8cf0d40081ed4b1c41ec2439e81f80692ac7c91c1fea7b7166f967facea02658916538acc19b6ee6d0ad87ab7cdae00736239a798b8ca9fc"
    ;;
  *)
    echo "Unsupported macOS runtime architecture: ${OPENAUTHOR_RUNTIME_ARCH:-$(uname -m)}" >&2
    exit 1
    ;;
esac

ASSET="cpython-${PYTHON_VERSION}+${RELEASE}-${ARCHIVE_ARCH}-apple-darwin-install_only.tar.gz"
URL="https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE}/${ASSET//+/%2B}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/openauthor-runtime.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading pinned Python ${PYTHON_VERSION} runtime for ${ARCHIVE_ARCH}..."
curl --fail --location --retry 3 --output "$TMP/python.tar.gz" "$URL"
ACTUAL_SHA256="$(shasum -a 256 "$TMP/python.tar.gz" | awk '{print $1}')"
if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
  echo "Runtime checksum mismatch: expected $EXPECTED_SHA256, received $ACTUAL_SHA256" >&2
  exit 1
fi

tar -xzf "$TMP/python.tar.gz" -C "$TMP"
if [[ ! -x "$TMP/python/bin/python3" ]]; then
  echo "Downloaded runtime does not contain python/bin/python3." >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$TMP/python" "$DEST"
printf '%s\n' \
  '# Keep the Tauri resource path present in clean source checkouts.' \
  '# Release bundles still require scripts/prepare_bundled_runtime.sh.' \
  > "$DEST/.gitkeep"

"$DEST/bin/python3" -m ensurepip --upgrade
"$DEST/bin/python3" -m pip install --disable-pip-version-check --no-build-isolation --no-deps --no-compile "$ROOT"
"$DEST/bin/python3" -I -m openauthor --help >/dev/null

CODEX_ASSET="codex-${CODEX_VERSION}-${CODEX_NPM_ARCH}.tgz"
CODEX_URL="https://registry.npmjs.org/@openai/codex/-/${CODEX_ASSET}"
echo "Downloading pinned Codex ${CODEX_VERSION} runtime for ${CODEX_NPM_ARCH}..."
curl --fail --location --retry 3 --output "$TMP/codex.tgz" "$CODEX_URL"
CODEX_ACTUAL_SHA512="$(shasum -a 512 "$TMP/codex.tgz" | awk '{print $1}')"
if [[ "$CODEX_ACTUAL_SHA512" != "$CODEX_EXPECTED_SHA512" ]]; then
  echo "Codex runtime checksum mismatch: expected $CODEX_EXPECTED_SHA512, received $CODEX_ACTUAL_SHA512" >&2
  exit 1
fi
mkdir -p "$TMP/codex-package"
tar -xzf "$TMP/codex.tgz" -C "$TMP/codex-package"
CODEX_SOURCE="$TMP/codex-package/package/vendor/$CODEX_TARGET"
if [[ ! -x "$CODEX_SOURCE/bin/codex" ]]; then
  echo "Downloaded Codex runtime does not contain $CODEX_TARGET/bin/codex." >&2
  exit 1
fi
rm -rf "$CODEX_DEST"
mkdir -p "$(dirname "$CODEX_DEST")"
mv "$CODEX_SOURCE" "$CODEX_DEST"
printf '%s\n' \
  '# Keep the Tauri resource path present in clean source checkouts.' \
  '# Release bundles still require scripts/prepare_bundled_runtime.sh.' \
  > "$CODEX_DEST/.gitkeep"
"$CODEX_DEST/bin/codex" --version

cat > "$CODEX_DEST/openauthor-codex-runtime.json" <<EOF
{
  "schema_version": 1,
  "codex_version": "$CODEX_VERSION",
  "architecture": "$CODEX_TARGET",
  "source_asset": "$CODEX_ASSET",
  "sha512": "$CODEX_EXPECTED_SHA512"
}
EOF

cat > "$DEST/openauthor-runtime.json" <<EOF
{
  "schema_version": 1,
  "python_version": "$PYTHON_VERSION",
  "python_build_release": "$RELEASE",
  "architecture": "$ARCHIVE_ARCH",
  "source_asset": "$ASSET",
  "sha256": "$EXPECTED_SHA256"
}
EOF

echo "Bundled runtimes prepared at $DEST and $CODEX_DEST"
