#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Pi Notifier setup supports macOS only." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package_root="$(cd "$script_dir/.." && pwd)"
icon="$package_root/assets/Pi.icns"
destination="$HOME/Applications/Pi Notifier.app"

if [[ ! -f "$icon" ]]; then
  echo "Missing bundled icon: $icon" >&2
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install terminal-notifier first: brew install terminal-notifier" >&2
  exit 1
fi

prefix="$(brew --prefix terminal-notifier 2>/dev/null || true)"
template="$prefix/terminal-notifier.app"
if [[ -z "$prefix" || ! -d "$template" ]]; then
  echo "terminal-notifier is required: brew install terminal-notifier" >&2
  exit 1
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/pi-notifier.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
app="$work_dir/Pi Notifier.app"
cp -R "$template" "$app"
rm -rf "$app/Contents/_CodeSignature"
find "$app/Contents/Resources" -maxdepth 1 -type f -name '*.icns' -delete
cp "$icon" "$app/Contents/Resources/Pi.icns"

plist="$app/Contents/Info.plist"
set_plist_string() {
  local key="$1"
  local value="$2"
  /usr/libexec/PlistBuddy -c "Set :$key $value" "$plist" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Add :$key string $value" "$plist"
}
set_plist_string CFBundleName 'Pi Notifier'
set_plist_string CFBundleDisplayName 'Pi Notifier'
set_plist_string CFBundleIdentifier com.alfheim.pi-notifier
set_plist_string CFBundleIconFile Pi
set_plist_string CFBundleVersion 1
set_plist_string CFBundleShortVersionString 1.0.0
/usr/bin/codesign --force --deep --sign - "$app" >/dev/null
/usr/bin/codesign --verify --deep --strict "$app"

mkdir -p "$(dirname "$destination")"
backup="${destination}.backup.$$"
if [[ -e "$destination" ]]; then
  mv "$destination" "$backup"
fi
if mv "$app" "$destination"; then
  rm -rf "$backup"
else
  rm -rf "$destination"
  if [[ -e "$backup" ]]; then mv "$backup" "$destination"; fi
  exit 1
fi

lsregister='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
if [[ -x "$lsregister" ]]; then
  "$lsregister" -f "$destination"
fi

echo "Installed $destination"
