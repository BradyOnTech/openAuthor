#!/usr/bin/env bash
set -euo pipefail

# macOS does not provide the Linux-style C.UTF-8 locale that some shells export.
export LANG="en_US.UTF-8"
export LC_ALL="en_US.UTF-8"
export LC_CTYPE="en_US.UTF-8"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/desktop/src-tauri/resources/runtime/python"
RELEASE="20260510"
PYTHON_VERSION="3.11.15"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The current release runtime builder supports macOS only." >&2
  exit 1
fi

case "${OPENAUTHOR_RUNTIME_ARCH:-$(uname -m)}" in
  arm64|aarch64)
    ARCHIVE_ARCH="aarch64"
    EXPECTED_SHA256="03bcedae9b19a48888d7dc8ba064f73f6efaaf2b13f6a8e1a1bcc062df13e855"
    ;;
  x86_64|amd64)
    ARCHIVE_ARCH="x86_64"
    EXPECTED_SHA256="5e388e3db8b59c8487ddd1423330b90fc7f0c6ef7eadec945441a180d0dd4bc4"
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

"$DEST/bin/python3" -m ensurepip --upgrade
"$DEST/bin/python3" -m pip install --disable-pip-version-check --no-build-isolation --no-deps --no-compile "$ROOT"
"$DEST/bin/python3" -I -m openauthor --help >/dev/null

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

echo "Bundled runtime prepared at $DEST"
