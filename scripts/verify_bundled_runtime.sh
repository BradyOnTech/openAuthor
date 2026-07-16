#!/usr/bin/env bash
set -euo pipefail

export LANG="en_US.UTF-8"
export LC_ALL="en_US.UTF-8"
export LC_CTYPE="en_US.UTF-8"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="$ROOT/desktop/src-tauri/resources/runtime/python"
PYTHON="$RUNTIME/bin/python3"
MANIFEST="$RUNTIME/openauthor-runtime.json"

if [[ ! -x "$PYTHON" ]]; then
  echo "Bundled Python is missing. Run scripts/prepare_bundled_runtime.sh first." >&2
  exit 1
fi
if [[ ! -f "$MANIFEST" ]]; then
  echo "Bundled runtime manifest is missing: $MANIFEST" >&2
  exit 1
fi

"$PYTHON" -I -c 'import openauthor, sqlite3; assert openauthor.__file__; assert sqlite3.sqlite_version'
"$PYTHON" -I -m openauthor --help >/dev/null
echo "Bundled runtime: OK ($("$PYTHON" -I -c 'import platform; print(platform.python_version(), platform.machine())'))"
