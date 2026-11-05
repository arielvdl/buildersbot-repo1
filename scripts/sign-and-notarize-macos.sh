#!/bin/zsh
# Signs a macOS build with the Developer ID Application identity, packs it in a DMG, notarizes the
# DMG and staples the ticket. This is the path a build goes through before it is handed to anyone
# outside the owner's Mac: a self-signed build only satisfies Gatekeeper on the machine that made it.
#
# Nothing asks for a password. The identity lives in the login keychain, whose items are already
# partitioned for codesign, pkgbuild and productsign, and the notary credentials live in the
# `bb-notary` keychain profile (`xcrun notarytool store-credentials`). See
# docs/RELEASING.md#sign-and-notarize-locally.
#
# Usage:
#   ./scripts/sign-and-notarize-macos.sh [path/to/Builders Bot.app]
#
# With no argument the app is taken from dist/mac-arm64 or dist/mac. The DMG is written beside the
# app. The app bundle is signed in place, so a `bun run package` output is not reusable unsigned.
set -euo pipefail

cd "$(dirname "$0")/.."

IDENTITY="Developer ID Application: CULTURA BUILDER EDUCACAO E TECNOLOGIA LTDA (HCT8F2D969)"
ENTITLEMENTS="build/entitlements.mac.plist"
INHERIT_ENTITLEMENTS="build/entitlements.mac.inherit.plist"
NOTARY_PROFILE="bb-notary"
APP=""

for argument in "$@"; do
  case "$argument" in
    -*) print -u2 "Unknown option: $argument"; exit 2 ;;
    *) APP="$argument" ;;
  esac
done

if [[ -z "$APP" ]]; then
  for candidate in "dist/mac-arm64/Builders Bot.app" "dist/mac/Builders Bot.app"; do
    [[ -d "$candidate" ]] && APP="$candidate" && break
  done
fi

if [[ -z "$APP" || ! -d "$APP" ]]; then
  print -u2 "No app bundle found. Run 'bun run package' first or pass a path."
  exit 1
fi

if ! security find-identity -v -p codesigning | grep -qF "$IDENTITY"; then
  print -u2 "The identity \"$IDENTITY\" is not in the login keychain."
  exit 1
fi

if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  print -u2 "The notary profile \"$NOTARY_PROFILE\" is missing or its credentials are stale."
  print -u2 "Create it with: xcrun notarytool store-credentials $NOTARY_PROFILE \\"
  print -u2 "  --apple-id financeiro@culturabuilder.com --team-id HCT8F2D969 --password <senha de app>"
  exit 1
fi

VERSION="$(bun -p 'require("./package.json").version')"
NAME="$(basename "$APP" .app)"
DMG="$(dirname "$APP")/$NAME-$VERSION-$(uname -m).dmg"

sign() {
  /usr/bin/codesign --force --options runtime --timestamp --sign "$IDENTITY" "$@"
}

print "Signing $APP"
print "  nested code"
# Deepest first, and everything nested: the app ships other bundles under Resources (the dictation
# helper and the remote desktop runtime), and the notary service rejects any Mach-O left out.
# `cua-driver` keeps its own signature and the Automation entitlement it carries.
is_ours() {
  [[ "$1" != *"/cua-driver/"* ]]
}

while IFS= read -r item; do
  is_ours "$item" || continue
  if file -b "$item" | grep -q "Mach-O"; then
    sign --entitlements "$INHERIT_ENTITLEMENTS" "$item" 2>/dev/null || true
  fi
done < <(find "$APP/Contents" -type f -not -path "*/MacOS/Builders Bot" -print | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2-)

while IFS= read -r bundle; do
  is_ours "$bundle" || continue
  sign --entitlements "$INHERIT_ENTITLEMENTS" "$bundle"
done < <(find "$APP/Contents" -type d \( -name "*.app" -o -name "*.framework" -o -name "*.xpc" -o -name "*.appex" \) -print | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2-)

print "  main executable"
sign --entitlements "$ENTITLEMENTS" "$APP/Contents/MacOS/Builders Bot"

# The Chrome host of the store channel (docs/architecture/browser.md). It is built here, not by
# electron-builder, because its code requirement names the team. A build without the `chrome-peer`
# addon gets no host, and the app keeps "Let agents use my Chrome" off.
PEER="$APP/Contents/Resources/chrome-peer/chrome-peer.node"
if [[ -f "$PEER" ]]; then
  print "  Chrome host and chrome-peer addon"
  sign "$PEER"
  case "$(/usr/bin/lipo -archs "$APP/Contents/MacOS/Builders Bot")" in
    arm64) ARCH=arm64 ;;
    x86_64) ARCH=x64 ;;
    *) print -u2 "The Chrome host is built for one architecture: arm64 or x86_64."; exit 1 ;;
  esac
  HOST_BUILD=".buildersbot-build/chrome-host/store/$ARCH"
  # The store channel needs the extension ID of the store listing, which exists only after the first
  # upload. Until then the app keeps "Let agents use my Chrome" off, so the build goes on without it.
  if bun scripts/build-chrome-host.ts --channel store --arch "$ARCH" --out "$HOST_BUILD" \
    --sign-identity "$IDENTITY" >/dev/null 2>&1; then
    HOST_FOLDER="$APP/Contents/Resources/chrome-host/darwin/$ARCH"
    mkdir -p "$HOST_FOLDER"
    cp "$HOST_BUILD/buildersbot-chrome-host" "$HOST_FOLDER/buildersbot-chrome-host"
  else
    print "  warning: no store Chrome host (no store extension ID yet); Chrome integration stays off"
  fi
else
  print "  no chrome-peer addon: the app gets no Chrome host"
fi

print "  bundle"
sign --entitlements "$ENTITLEMENTS" "$APP"
/usr/bin/codesign --verify --deep --strict "$APP"

print "Building $DMG"
rm -f "$DMG"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -c -a "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
/usr/bin/hdiutil create -quiet -volname "$NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
/usr/bin/codesign --force --timestamp --sign "$IDENTITY" "$DMG"
/usr/bin/codesign --verify --strict "$DMG"

print "Notarizing (this takes minutes)"
/usr/bin/xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait

print "Stapling"
/usr/bin/xcrun stapler staple "$DMG"
/usr/bin/xcrun stapler validate "$DMG"
/usr/sbin/spctl --assess --type open --context context:primary-signature -v "$DMG"

print "Done: $DMG"
