#!/bin/sh

set -eu

APP_NAME="Scribo"
APP_BUNDLE="dist/Scribo-darwin-arm64/${APP_NAME}.app"
DMG_PATH="dist/${APP_NAME}.dmg"
STAGING_DIR="$(mktemp -d "/tmp/${APP_NAME}-dmg.XXXXXX")"

cleanup() {
  rm -rf "$STAGING_DIR"
}

trap cleanup EXIT INT TERM

if [ ! -d "$APP_BUNDLE" ]; then
  echo "Missing app bundle at $APP_BUNDLE" >&2
  exit 1
fi

rm -f "$DMG_PATH"
ditto "$APP_BUNDLE" "$STAGING_DIR/${APP_NAME}.app"
ln -s /Applications "$STAGING_DIR/Applications"

hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH"
