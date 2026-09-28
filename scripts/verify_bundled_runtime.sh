#!/usr/bin/env bash
set -euo pipefail

export LANG="en_US.UTF-8"
export LC_ALL="en_US.UTF-8"
export LC_CTYPE="en_US.UTF-8"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="$ROOT/desktop/src-tauri/resources/runtime/python"
PYTHON="$RUNTIME/bin/python3"
MANIFEST="$RUNTIME/openauthor-runtime.json"
CODEX_RUNTIME="$ROOT/desktop/src-tauri/resources/runtime/codex"
CODEX="$CODEX_RUNTIME/bin/codex"
CODEX_MANIFEST="$CODEX_RUNTIME/openauthor-codex-runtime.json"
SCHEMA_CHECK="$(mktemp -d "${TMPDIR:-/tmp}/openauthor-codex-schema.XXXXXX")"
trap 'rm -rf "$SCHEMA_CHECK"' EXIT

if [[ ! -x "$PYTHON" ]]; then
  echo "Bundled Python is missing. Run scripts/prepare_bundled_runtime.sh first." >&2
  exit 1
fi
if [[ ! -f "$MANIFEST" ]]; then
  echo "Bundled runtime manifest is missing: $MANIFEST" >&2
  exit 1
fi
if [[ ! -x "$CODEX" ]]; then
  echo "Bundled Codex is missing. Run scripts/prepare_bundled_runtime.sh first." >&2
  exit 1
fi
if [[ ! -f "$CODEX_MANIFEST" ]]; then
  echo "Bundled Codex runtime manifest is missing: $CODEX_MANIFEST" >&2
  exit 1
fi

"$PYTHON" -I -c 'import openauthor, sqlite3; assert openauthor.__file__; assert sqlite3.sqlite_version'
"$PYTHON" -I -m openauthor --help >/dev/null
"$PYTHON" -I "$ROOT/scripts/verify_packaged_recovery.py"
"$CODEX" app-server generate-json-schema --out "$SCHEMA_CHECK" >/dev/null
echo "Bundled runtime: OK ($("$PYTHON" -I -c 'import platform; print(platform.python_version(), platform.machine())'))"
echo "Bundled Codex runtime: OK ($("$CODEX" --version))"
