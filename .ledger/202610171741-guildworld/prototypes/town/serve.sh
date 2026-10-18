#!/bin/sh
# PROTOTYPE: serve the Agent World town on http://127.0.0.1:8765/ (Ctrl-C to stop).
cd "$(dirname "$0")"
echo "Agent World town prototype: http://127.0.0.1:${PORT:-8765}/"
exec python3 -m http.server "${PORT:-8765}" --bind 127.0.0.1
