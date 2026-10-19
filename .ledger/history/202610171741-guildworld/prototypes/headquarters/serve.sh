#!/bin/sh
# PROTOTYPE: serve the Agent World headquarters on http://127.0.0.1:8766/ (Ctrl-C to stop).
cd "$(dirname "$0")"
echo "Agent World headquarters prototype: http://127.0.0.1:${PORT:-8766}/"
exec python3 -m http.server "${PORT:-8766}" --bind 127.0.0.1
