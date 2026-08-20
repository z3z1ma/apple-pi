#!/usr/bin/env bash
# Emit one picker row per live Pi session that occupies a tmux pane.
#
# The Pi extension publishes a JSON record per session (pid, status, pane id,
# cwd, timestamps). Identity is that record — its pane id joins straight to a
# tmux pane, so no pid -> tty -> pane guessing is needed.
#
# A record is live only when BOTH its pid is still running AND its pane id still
# exists in tmux. Either check alone is insufficient: a SIGKILL'd Pi leaves a
# stale record its own shutdown hook never removed, and pid reuse could mask it.
# Records whose pid is gone are pruned here so the directory does not grow.
#
#   Row: rank \t pane_id \t pid \t kind \t icon \t age \t loc \t name \t path
#   rank/pane_id/pid/kind are hidden from the display via fzf's --with-nth.
#   name is the Pi session name when set, else the tmux pane title/window name.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
. "$DIR/helpers.sh"

command -v jq >/dev/null 2>&1 || exit 0

SD="$(state_dir)"
[ -d "$SD" ] || exit 0

shopt -s nullglob
files=("$SD"/*.json)
[ "${#files[@]}" -gt 0 ] || exit 0

prefix="$(get_tmux_option @pi_session_prefix 'pi-')"

# Agent records as TSV, one line each. A crashed Pi's record (pid not running)
# is deleted on sight; a record we cannot parse is skipped.
records=''
for f in "${files[@]}"; do
  data="$(cat "$f" 2>/dev/null)" || continue
  pid="$(printf '%s' "$data" | jq -r '.pid // empty' 2>/dev/null)"
  [ -n "$pid" ] || continue
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$f" 2>/dev/null
    continue
  fi
  row="$(printf '%s' "$data" |
    jq -r 'select(type == "object") | [.pid, .status, .paneId, .cwd, .updatedAt, (.sessionName // "")] | @tsv' \
      2>/dev/null)" || continue
  [ -n "$row" ] && records+="$row"$'\n'
done
[ -n "$records" ] || exit 0

# Two tagged streams into one awk: pane_id -> (session, location), and the agent
# records themselves. A record whose pane no longer exists is dropped.
{
  tmux list-panes -a -F $'T\t#{pane_id}\t#{session_name}\t#{session_name}:#{window_index}.#{pane_index}\t#{window_name}\t#{pane_title}' 2>/dev/null
  printf '%s' "$records" | sed $'s/^/A\t/'
} | awk -F'\t' -v now="$(date +%s)" -v home="$HOME" -v prefix="$prefix" '
  # pane_title may itself contain a tab; keep it last and rejoin the remainder.
  $1 == "T" {
    pane[$2] = 1; sess[$2] = $3; loc[$2] = $4; wname[$2] = $5
    title = $6
    for (i = 7; i <= NF; i++) title = title "\t" $i
    ptitle[$2] = title
    next
  }
  $1 == "A" {
    status = $3; paneid = $4; cwd = $5; updated = $6; sname = $7
    if (!(paneid in pane)) next   # the pane is gone: crashed or killed Pi

    if      (status == "waiting") { icon = "\033[33m●\033[0m waiting"; rank = 0 }  # yellow - needs you
    else if (status == "idle")    { icon = "\033[32m●\033[0m idle   "; rank = 1 }  # green  - your turn
    else if (status == "busy")    { icon = "\033[31m●\033[0m working"; rank = 3 }  # red    - working
    else                          { icon = "\033[90m●\033[0m   ?    "; rank = 2 }  # grey   - unknown

    age = (updated != "") ? int((now - updated) / 60) "m" : "-"
    kind = (index(sess[paneid], prefix) == 1) ? "dedicated" : "loose"

    path = cwd
    if (index(path, home) == 1) path = "~" substr(path, length(home) + 1)

    # A human label: prefer the Pi session name, then a cleaned pane title,
    # then the tmux window name.
    name = sname
    if (name == "") {
      name = ptitle[paneid]
      # Alternation of whole characters, not bracket classes: in a non-UTF-8
      # (C) locale awk treats [⠋…] as a set of single bytes and would strip one
      # lead byte, leaving mojibake. Each alternative matches a full byte string.
      sub(/^(⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏) */, "", name)   # strip a leading spinner frame
      sub(/^π *(-|–|—|\||·|:)? */, "", name)         # strip a leading "π - " prefix
    }
    if (name == "") name = wname[paneid]
    if (name == "") name = "-"
    if (length(name) > 30) name = substr(name, 1, 29) "…"

    printf "%s\t%s\t%s\t%s\t%s\t%5s\t%s\t%s\t%s\n",
      rank, paneid, $2, kind, icon, age, loc[paneid], name, path
  }
' | sort -t$'\t' -k1,1n -k6,6n
# rank asc (what needs you floats up), then age asc so whatever just changed
# sits at the top of its group.
