#!/usr/bin/env bash
# Sourced by build recipes; does not change the user's shell configuration.
if ! command -v cargo >/dev/null 2>&1; then
  for openauthor_rust_bin in "$HOME/.cargo/bin" /opt/homebrew/opt/rustup/bin /usr/local/opt/rustup/bin; do
    if [[ -x "$openauthor_rust_bin/cargo" ]]; then
      export PATH="$openauthor_rust_bin:$PATH"
      break
    fi
  done
  unset openauthor_rust_bin
fi
