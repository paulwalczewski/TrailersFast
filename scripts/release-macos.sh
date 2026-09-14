#!/usr/bin/env bash
#
# Build, sign, notarize and staple the macOS DMG, then publish it as a GitHub
# Release. Tauri does the build, the Developer ID signing (hardened runtime,
# FFmpeg sidecar included) and the DMG; notarization is done here because
# Tauri's bundler only takes raw Apple credentials via env vars, while ours
# live in a notarytool keychain profile.
#
# One-time setup:
#   1. A "Developer ID Application" certificate in the login keychain
#      (security find-identity -v -p codesigning must list one).
#   2. A notarytool profile:
#        xcrun notarytool store-credentials <profile> --key AuthKey.p8 --key-id … --issuer …
#      Pass its name as NOTARY_PROFILE (default below).
#   3. scripts/fetch-ffmpeg.sh, so the sidecar exists for this machine's target.
#   4. gh auth login, for the release upload.
#
# Usage: scripts/release-macos.sh            # build + notarize, no upload
#        scripts/release-macos.sh --publish  # …and create/update the GitHub Release
set -euo pipefail

NOTARY_PROFILE="${NOTARY_PROFILE:-trailersfast-notary}"
REPO="${REPO:-paulwalczewski/TrailersFast}"
PUBLISH=0
[[ "${1:-}" == "--publish" ]] && PUBLISH=1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$ROOT/apps/desktop/src-tauri"
CONF="$TAURI_DIR/tauri.conf.json"
VERSION="$(jq -r .version "$CONF")"
PRODUCT="$(jq -r .productName "$CONF")"
TRIPLE="$(rustc -vV | sed -n 's/host: //p')"
case "$TRIPLE" in
  aarch64-apple-darwin) ARCH=aarch64 ;;
  x86_64-apple-darwin) ARCH=x64 ;;
  *) echo "✗ $TRIPLE is not a macOS target" >&2; exit 1 ;;
esac
TAG="v$VERSION"

DEV_ID="$(security find-identity -v -p codesigning | grep -o 'Developer ID Application: [^"]*' | head -1 || true)"
[[ -n "$DEV_ID" ]] || { echo "✗ No 'Developer ID Application' certificate in the keychain." >&2; exit 1; }
[[ -x "$TAURI_DIR/binaries/ffmpeg-$TRIPLE" ]] || { echo "✗ Missing FFmpeg sidecar; run scripts/fetch-ffmpeg.sh first." >&2; exit 1; }

NOTES="$ROOT/scripts/release-notes/$VERSION.md"
if [[ $PUBLISH -eq 1 && ! -s "$NOTES" ]]; then
  echo "✗ No release notes at $NOTES (checked before the build so a missing file costs nothing)." >&2
  exit 1
fi

echo "▸ $PRODUCT $VERSION ($ARCH), signing as: $DEV_ID"

# 1. Build + sign. APPLE_SIGNING_IDENTITY makes the bundler codesign the app,
#    every framework and the FFmpeg sidecar with --options runtime --timestamp.
cd "$ROOT"
APPLE_SIGNING_IDENTITY="$DEV_ID" pnpm tauri build --bundles app,dmg

BUNDLE="$TAURI_DIR/target/release/bundle"
APP="$BUNDLE/macos/$PRODUCT.app"
DMG="$BUNDLE/dmg/${PRODUCT}_${VERSION}_${ARCH}.dmg"
[[ -d "$APP" ]] || { echo "✗ No app at $APP" >&2; exit 1; }
[[ -f "$DMG" ]] || { echo "✗ No DMG at $DMG" >&2; exit 1; }

echo "▸ Verifying signatures…"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign --verify --verbose=2 "$DMG"

# 2. Notarize the DMG (Apple scans the app inside it too) and staple the ticket.
echo "▸ Notarizing (usually a few minutes)…"
xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
spctl -a -t open --context context:primary-signature -v "$DMG"

# Stable-named copy so …/releases/latest/download/<name>.dmg keeps working.
DIST="$ROOT/dist"
mkdir -p "$DIST"
SAFE_NAME="$(echo "$PRODUCT" | tr -d ' ')"
OUT="$DIST/${SAFE_NAME}-${VERSION}-${ARCH}.dmg"
STABLE="$DIST/${SAFE_NAME}-${ARCH}.dmg"
cp "$DMG" "$OUT"
cp "$DMG" "$STABLE"
shasum -a 256 "$OUT"
echo "✓ $OUT"

[[ $PUBLISH -eq 1 ]] || { echo "  (re-run with --publish to create the GitHub Release)"; exit 0; }

# 3. GitHub Release. Re-running re-uploads with --clobber and re-syncs the notes.
echo "▸ Publishing ${TAG} to ${REPO}…"
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "$OUT" "$STABLE" --repo "$REPO" --clobber
  gh release edit "$TAG" --repo "$REPO" --title "$PRODUCT $VERSION" --notes-file "$NOTES"
else
  gh release create "$TAG" "$OUT" "$STABLE" --repo "$REPO" --title "$PRODUCT $VERSION" --notes-file "$NOTES"
fi
echo "✓ https://github.com/$REPO/releases/tag/$TAG"
