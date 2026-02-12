#!/usr/bin/env bash
set -euo pipefail

failures=0

check_cmd() {
  local cmd="$1"
  local hint="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "$cmd: OK ($(command -v "$cmd"))"
  else
    echo "$cmd: MISSING ($hint)"
    failures=1
  fi
}

echo "Checking desktop prerequisites for openAuthor..."
check_cmd python3 "Install Python 3.10+ and ensure 'python3' is on PATH."
check_cmd node "Install Node.js 20+."
check_cmd npm "Install npm (bundled with Node.js)."
check_cmd cargo "Install Rust toolchain via rustup."

if command -v python3 >/dev/null 2>&1; then
  if python3 -c "import openauthor" >/dev/null 2>&1; then
    echo "python openauthor import: OK"
  else
    echo "python openauthor import: MISSING (run 'pip install -e .')"
    failures=1
  fi
fi

if [[ "$failures" -ne 0 ]]; then
  echo "Desktop prerequisite check failed."
  exit 1
fi

echo "Desktop prerequisite check passed."
