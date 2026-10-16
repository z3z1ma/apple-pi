#!/usr/bin/env bash
# PROTOTYPE: compile the notch shell and run it in the foreground. Ctrl-C quits.
# Usage: run.sh [page]   page is a file in web/, default room.html (prototype 2); index.html is prototype 1.
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
swiftc -O "$dir/NotchShell.swift" -o /tmp/pi-notch-prototype
exec /tmp/pi-notch-prototype "$dir" "${1:-room.html}"
