#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:-$ROOT/desktop/src-tauri/target/release/bundle/macos/openAuthor.app}"
RUNTIME="$APP/Contents/Resources/resources/runtime/python"

if [[ ! -d "$APP" ]]; then
  echo "macOS application bundle not found: $APP" >&2
  exit 1
fi
if [[ ! -x "$RUNTIME/bin/python3" ]]; then
  echo "Bundled Python was not copied to the expected application resource path." >&2
  exit 1
fi

export LANG="en_US.UTF-8"
export LC_ALL="en_US.UTF-8"
export LC_CTYPE="en_US.UTF-8"
"$RUNTIME/bin/python3" -I -c 'import openauthor, sqlite3; assert openauthor.__file__; assert sqlite3.sqlite_version'
"$RUNTIME/bin/python3" -I -m openauthor --help >/dev/null
"$RUNTIME/bin/python3" -I "$ROOT/scripts/verify_packaged_recovery.py"
OPENAUTHOR_CODEX_CONTRACT_BIN="$APP/Contents/Resources/resources/runtime/codex/bin/codex" \
  "$RUNTIME/bin/python3" -I -m unittest discover -s "$ROOT/tests" -p test_codex_runtime_contract.py -v

if [[ "${OPENAUTHOR_REQUIRE_SIGNED_BUNDLE:-0}" == "1" ]]; then
  codesign --verify --deep --strict --verbose=2 "$APP"
  SIGNATURE_METADATA="$(codesign -dv --verbose=4 "$APP" 2>&1)"
  SIGNING_AUTHORITY="$(printf '%s\n' "$SIGNATURE_METADATA" | sed -n 's/^Authority=//p' | head -1)"
  if [[ "$SIGNING_AUTHORITY" != "Developer ID Application: "* ]]; then
    echo "A Developer ID Application signature is required." >&2
    exit 1
  fi
  if [[ "$SIGNATURE_METADATA" != *"(runtime)"* ]]; then
    echo "The signed bundle must enable the hardened runtime." >&2
    exit 1
  fi
  xcrun stapler validate "$APP"
  spctl --assess --type execute --verbose=4 "$APP"
fi

REPORT_ARGS=()
if [[ -n "${OPENAUTHOR_BUNDLE_REPORT_PATH:-}" ]]; then
  REPORT_ARGS=(--report "$OPENAUTHOR_BUNDLE_REPORT_PATH")
fi
"$RUNTIME/bin/python3" -I "$ROOT/scripts/verify_packaged_sources.py" --app "$APP" "${REPORT_ARGS[@]}"

echo "macOS bundle: OK ($APP)"
