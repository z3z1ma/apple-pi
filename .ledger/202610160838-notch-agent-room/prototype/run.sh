#!/usr/bin/env bash
# PROTOTYPE: compile the notch shell and run it in the foreground. Ctrl-C quits.
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
swiftc -O "$dir/NotchShell.swift" -o /tmp/pi-notch-prototype
exec /tmp/pi-notch-prototype "$dir"
