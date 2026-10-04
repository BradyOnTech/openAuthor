#!/usr/bin/env bash
set -euo pipefail
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LC_CTYPE=en_US.UTF-8

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/rust_env.sh"
DEST="$ROOT/desktop/src-tauri/resources/runtime/git"
VERSION="2.55.0"
SHA256="0842dc384a23ac33ba3e570c4f3a8ded85963ee4713b1cd21153c3db41813d1e"
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Embedded Git currently supports macOS release builds only." >&2
  exit 1
fi
ARCH="${OPENAUTHOR_RUNTIME_ARCH:-$(uname -m)}"
if [[ "$ARCH" != "$(uname -m)" ]]; then
  echo "Build embedded Git on a native $ARCH runner; do not execute cross-architecture tools." >&2
  exit 1
fi
WORK="$(mktemp -d "${TMPDIR:-/tmp}/openauthor-git.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
curl --fail --location --retry 3 --output "$WORK/git.tar.gz" "https://www.kernel.org/pub/software/scm/git/git-${VERSION}.tar.gz"
ACTUAL="$(shasum -a 256 "$WORK/git.tar.gz" | awk '{print $1}')"
if [[ "$ACTUAL" != "$SHA256" ]]; then
  echo "Embedded Git source checksum mismatch." >&2
  exit 1
fi
tar -xzf "$WORK/git.tar.gz" -C "$WORK"
SDK="$(xcrun --show-sdk-path)"
# Storylines only need local Git builtins. Avoid dependencies on Homebrew,
# credentials helpers, network transports, Perl, Tcl/Tk, or external libraries.
make -C "$WORK/git-$VERSION" -j "$(sysctl -n hw.logicalcpu)" git \
  CC="$(xcrun --find clang)" CFLAGS="-O2 -mmacosx-version-min=12.0 -isysroot $SDK" \
  LDFLAGS="-mmacosx-version-min=12.0 -isysroot $SDK" prefix=/openauthor-embedded-git \
  RUNTIME_PREFIX=YesPlease NO_CURL=YesPlease NO_OPENSSL=YesPlease \
  NO_EXPAT=YesPlease NO_GETTEXT=YesPlease NO_PERL=YesPlease NO_TCLTK=YesPlease \
  NO_PYTHON=YesPlease NO_PCRE=YesPlease
mkdir -p "$DEST/bin" "$DEST/share/git-core/templates"
install -m 755 "$WORK/git-$VERSION/git" "$DEST/bin/git"
install -m 644 "$WORK/git-$VERSION/COPYING" "$DEST/COPYING"
# Ship the corresponding source with the binary for GPL redistribution.
install -m 644 "$WORK/git.tar.gz" "$DEST/git-${VERSION}-source.tar.gz"
"$DEST/bin/git" --version
otool -L "$DEST/bin/git"
