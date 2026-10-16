#!/usr/bin/env bash
# Build the notch panel from its Swift source when that source changed, then start it in the background.
# Usage: notch.sh start
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pi_home="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
log_path="$pi_home/logs/pi-notch.log"
source_file="$here/notch/NotchShell.swift"

log() {
  mkdir -p "$(dirname "$log_path")"
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$log_path"
}

start() {
  [[ "$(uname)" == Darwin ]] || return 0
  if ! command -v swiftc >/dev/null 2>&1; then
    log "not started: swiftc not found; install the Xcode command line tools"
    return 0
  fi
  local hash bin
  hash="$(shasum -a 256 "$source_file" | cut -c1-16)"
  bin="$pi_home/cache/notch/pi-notch-$hash"
  if [[ ! -x "$bin" ]]; then
    mkdir -p "$(dirname "$bin")" "$(dirname "$log_path")"
    # Build to a private name and rename into place, so a concurrent start never runs a half-written binary.
    if ! swiftc -O "$source_file" -o "$bin.$$" >>"$log_path" 2>&1; then
      rm -f "$bin.$$"
      log "not started: build of $source_file failed"
      return 1
    fi
    mv "$bin.$$" "$bin"
    log "built $bin"
  fi
  local focus_dir
  focus_dir="$(cd "$here/../notify/scripts" && pwd)"
  nohup "$bin" "$here/notch/web" "$here/sidebar/agents.py" "$focus_dir/focus-tmux.sh" </dev/null >>"$log_path" 2>&1 &
}

case "${1:-}" in
  start) start ;;
  *)
    echo "usage: notch.sh start" >&2
    exit 64
    ;;
esac
