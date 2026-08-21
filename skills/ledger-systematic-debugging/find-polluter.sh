#!/usr/bin/env bash
# Find the first test that creates an unwanted file or directory.
# Usage: ./find-polluter.sh <path-to-check> <test-file-pattern>

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <path-to-check> <test-file-pattern>"
  echo "Example: $0 '.git' 'src/**/*.test.ts'"
  exit 2
fi

pollution_check="$1"
test_pattern="${2#./}"
collapsed_pattern="${test_pattern//\*\*\//}"
test_list="$(mktemp)"
trap 'rm -f "$test_list"' EXIT

find . \( -path "./$test_pattern" -o -path "./$collapsed_pattern" \) -type f -print | sort -u > "$test_list"
total="$(wc -l < "$test_list" | tr -d ' ')"

if [[ "$total" -eq 0 ]]; then
  echo "No test files match: $2"
  exit 2
fi
if [[ -e "$pollution_check" ]]; then
  echo "Pollution already exists before the search: $pollution_check"
  exit 2
fi

count=0
while IFS= read -r test_file; do
  count=$((count + 1))
  echo "[$count/$total] $test_file"
  npm test "$test_file" >/dev/null 2>&1 || true
  if [[ -e "$pollution_check" ]]; then
    echo "Polluter: $test_file"
    echo "Created: $pollution_check"
    ls -la "$pollution_check"
    exit 1
  fi
done < "$test_list"

echo "No polluter found across $total test files."
