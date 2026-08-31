#!/usr/bin/env bash
# Stop the ledger visual companion server and clean up
# Usage: stop-server.sh [--status] <session_dir>
#
# Kills the server process and deletes its direct-child /tmp runtime directory.
# Persistent ledger evidence directories are kept so mockups can be reviewed later.
# --status checks the PID plus per-start server instance ID without changing state.

STATUS_ONLY="false"
if [[ "${1:-}" == "--status" ]]; then
  STATUS_ONLY="true"
  shift
fi
SESSION_DIR="${1:-}"

if [[ -z "$SESSION_DIR" ]]; then
  echo '{"error": "Usage: stop-server.sh [--status] <session_dir>"}'
  exit 1
fi

if ! [[ "$SESSION_DIR" =~ ^/tmp/ledger-visual-[^/]+$ ]] || [[ -L "$SESSION_DIR" ]] || [[ ! -d "$SESSION_DIR" ]]; then
  echo '{"error": "session_dir must be an existing direct /tmp/ledger-visual-* runtime directory"}'
  exit 1
fi

STATE_DIR="${SESSION_DIR}/state"
if [[ -L "$STATE_DIR" ]] || [[ ! -d "$STATE_DIR" ]]; then
  echo '{"error": "runtime state directory is missing or unsafe"}'
  exit 1
fi
PID_FILE="${STATE_DIR}/server.pid"
SERVER_ID_FILE="${STATE_DIR}/server-instance-id"

cleanup_ephemeral_runtime() {
  if [[ "$SESSION_DIR" =~ ^/tmp/ledger-visual-[^/]+$ ]]; then
    rm -rf -- "$SESSION_DIR"
  fi
}

read_expected_server_id() {
  [[ -f "$SERVER_ID_FILE" ]] || return 1
  local id
  id="$(tr -d '\r\n' < "$SERVER_ID_FILE" 2>/dev/null || true)"
  [[ "$id" =~ ^[A-Za-z0-9_-]{32,64}$ ]] || return 1
  printf '%s\n' "$id"
}

command_line_for_pid() {
  local pid="$1"
  if [[ -r "/proc/$pid/cmdline" ]]; then
    tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null || true
    return 0
  fi
  ps -ww -p "$pid" -o command= 2>/dev/null || ps -f -p "$pid" 2>/dev/null | sed '1d' || true
}

command_has_server_id() {
  local pid="$1"
  local expected="$2"
  local expected_arg="--ledger-visual-server-id=$expected"
  if [[ -r "/proc/$pid/cmdline" ]]; then
    local arg
    while IFS= read -r -d '' arg || [[ -n "$arg" ]]; do
      [[ "$arg" == "$expected_arg" ]] && return 0
    done < "/proc/$pid/cmdline"
    return 1
  fi
  local command_line
  command_line="$(command_line_for_pid "$pid")"
  [[ -n "$command_line" ]] || return 1
  case " $command_line " in
    *" $expected_arg "*) return 0 ;;
    *) return 1 ;;
  esac
}

# Confirm a PID has this session's per-start instance id, not just a familiar
# process name. Ambiguous or legacy metadata fails closed as stale_pid.
is_ledger_visual_server() {
  kill -0 "$1" 2>/dev/null || return 1
  local expected_id
  expected_id="$(read_expected_server_id)" || return 1
  command_has_server_id "$1" "$expected_id" || return 1
  return 0
}

if [[ "$STATUS_ONLY" == "true" ]]; then
  if [[ -f "$PID_FILE" ]]; then
    pid=$(cat "$PID_FILE")
    if is_ledger_visual_server "$pid"; then
      echo '{"status": "running"}'
      exit 0
    fi
  fi
  echo '{"status": "stale"}'
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  pid=$(cat "$PID_FILE")

  # Refuse to signal a PID we can't prove is our server. A stale pid file may
  # point at an unrelated process after a reboot/PID wraparound.
  if ! is_ledger_visual_server "$pid"; then
    cleanup_ephemeral_runtime
    echo '{"status": "stale_pid"}'
    exit 0
  fi

  # Try to stop gracefully, fallback to force if still alive
  kill "$pid" 2>/dev/null || true

  # Wait for graceful shutdown (up to ~2s)
  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done

  # If still running, escalate to SIGKILL
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true

    # Give SIGKILL a moment to take effect
    sleep 0.1
  fi

  if kill -0 "$pid" 2>/dev/null; then
    echo '{"status": "failed", "error": "process still running"}'
    exit 1
  fi

  cleanup_ephemeral_runtime

  echo '{"status": "stopped"}'
else
  cleanup_ephemeral_runtime
  echo '{"status": "not_running"}'
fi
