#!/usr/bin/env bash
# AgentLayer's setup guide: curl -fsSL https://agentlayer.one/install.sh | bash
# It checks this machine and shows each step to do. It runs nothing itself: you run every command.
# By hand instead: https://agentlayer.one/docs/getting-started/install
[ -n "${BASH_VERSION:-}" ] || { echo "install: pipe this to bash, not sh." >&2; exit 1; }
set -euo pipefail

RELEASE="v1.1.0"
SOURCE_URL="https://raw.githubusercontent.com/AgentLayer1/agentlayer-agent/$RELEASE/install"
DOCS_URL="https://agentlayer.one/docs/getting-started/install"

die() {
  printf 'install: %s\n' "$1" >&2
  exit "${2:-1}"
}

guide_for_this_system() {
  case "$(uname -s)" in
    Darwin) printf 'macos' ;;
    Linux) printf 'linux' ;;
    MINGW* | MSYS* | CYGWIN*) die "On Windows, run this in PowerShell instead: irm https://agentlayer.one/install.ps1 | iex" ;;
    *) die "This guide covers macOS and Linux. Elsewhere, follow $DOCS_URL" ;;
  esac
}

# From a checkout the guides sit beside this file; piped from curl, they're fetched from the same repository.
local_guides() {
  local here
  [[ -n ${BASH_SOURCE[0]:-} && -f ${BASH_SOURCE[0]} ]] || return 1
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install"
  [[ -f $here/lib.sh ]] || return 1
  printf '%s' "$here"
}

fetch_guides() {
  local guide=$1 dir=$2 file
  for file in lib.sh "$guide.sh"; do
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL "$SOURCE_URL/$file" -o "$dir/$file" </dev/null ||
      die "Couldn't download the guide ($file). Check your connection, then run the line again."
    # A file cut short at a function boundary still parses, so each one ends with a known last line.
    [[ "$(tail -n 1 "$dir/$file")" == "# agentlayer:end" ]] && bash -n "$dir/$file" ||
      die "The downloaded guide ($file) is incomplete. Run the line again."
  done
}

main() {
  local guide dir="" status=0
  [[ -z ${SUDO_USER:-} && $(id -u) -ne 0 ]] || die "Run this without sudo: nothing here needs it."
  guide=$(guide_for_this_system)
  if ! dir=$(local_guides); then
    dir=$(mktemp -d "${TMPDIR:-/tmp}/agentlayer-guide-XXXXXX")
    trap 'rm -rf "$dir"' EXIT
    fetch_guides "$guide" "$dir"
  fi
  # Opening the terminal is the real test: /dev/tty can look readable where there is no terminal behind it.
  if { : </dev/tty; } 2>/dev/null; then
    bash "$dir/$guide.sh" "$@" </dev/tty || status=$?
  else
    bash "$dir/$guide.sh" --list "$@" </dev/null || status=$?
  fi
  exit "$status"
}

main "$@"
