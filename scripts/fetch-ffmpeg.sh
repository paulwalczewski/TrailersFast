#!/usr/bin/env bash
#
# Fetch a full, freetype-enabled FFmpeg for the current platform and place it as
# a Tauri sidecar binary at apps/desktop/src-tauri/binaries/ffmpeg-<target-triple>.
#
# The bundled FFmpeg ships inside the app installer, so users never need their own
# — and it has the `drawtext` filter required to burn in the intro + watermark.
# Run this once before `pnpm tauri build` (and in CI). The binary is git-ignored.
#
# Integrity: every download is SHA-256 checked. Set FFMPEG_SHA256 to the digest
# you expect (printed at the end of every run) to pin a build; with it unset the
# script prints the digest it got and warns that it was not verified. Pin it in
# CI so a swapped upstream archive fails the build instead of shipping.
#
# Usage: [FFMPEG_SHA256=<hex>] scripts/fetch-ffmpeg.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/apps/desktop/src-tauri/binaries"
TRIPLE="$(rustc -vV | sed -n 's/host: //p')"
OUT="$DEST/ffmpeg-$TRIPLE"
mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Target triple: $TRIPLE"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# Download to $2, then verify against FFMPEG_SHA256 when set.
fetch() {
  curl -fsSL -A "Mozilla/5.0" -o "$2" "$1"
  ARCHIVE_SHA="$(sha256 "$2")"
  if [ -n "${FFMPEG_SHA256:-}" ]; then
    if [ "$ARCHIVE_SHA" != "$FFMPEG_SHA256" ]; then
      echo "✗ SHA-256 mismatch for $1" >&2
      echo "  expected: $FFMPEG_SHA256" >&2
      echo "  got:      $ARCHIVE_SHA" >&2
      exit 1
    fi
    echo "✓ archive SHA-256 verified"
  else
    echo "! archive SHA-256 not verified (set FFMPEG_SHA256=$ARCHIVE_SHA to pin it)" >&2
  fi
}

case "$TRIPLE" in
  aarch64-apple-darwin)
    # osxexperts full arm64 build (freetype/fontconfig/harfbuzz); needs a browser UA.
    fetch "https://www.osxexperts.net/ffmpeg80arm.zip" "$TMP/ff.zip"
    unzip -o "$TMP/ff.zip" -d "$TMP" >/dev/null
    cp "$TMP/ffmpeg" "$OUT"
    ;;
  x86_64-apple-darwin)
    # evermeet full x86_64 build (freetype/fontconfig/harfbuzz).
    fetch "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip" "$TMP/ff.zip"
    unzip -o "$TMP/ff.zip" -d "$TMP" >/dev/null
    cp "$TMP/ffmpeg" "$OUT"
    ;;
  x86_64-unknown-linux-gnu)
    # BtbN static GPL build off the 8.1 release branch (freetype/fontconfig/harfbuzz).
    # Not John Van Sickle's: since FFmpeg 7.0 drawtext also needs libharfbuzz,
    # which that build lacks, so it fails the check below.
    fetch "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz" "$TMP/ff.tar.xz"
    tar -xf "$TMP/ff.tar.xz" -C "$TMP"
    cp "$TMP"/ffmpeg-n8.1-*-linux64-gpl-8.1/bin/ffmpeg "$OUT"
    ;;
  *)
    echo "No download rule for $TRIPLE." >&2
    echo "Add one (a full build WITH --enable-libfreetype) and place it at:" >&2
    echo "  $OUT" >&2
    exit 1
    ;;
esac

chmod +x "$OUT"

# Sanity check: must have the drawtext filter (freetype) or intro/watermark won't render.
# (Capture first: piping straight into `grep -q` makes FFmpeg die on SIGPIPE,
# which `set -o pipefail` would report as a failed check.)
FILTERS="$("$OUT" -hide_banner -filters 2>/dev/null || true)"
if grep -q " drawtext " <<<"$FILTERS"; then
  echo "✓ $OUT  ($("$OUT" -hide_banner -version 2>/dev/null | head -1 | cut -c1-40))"
  echo "✓ drawtext filter present"
  echo "  binary SHA-256: $(sha256 "$OUT")"
else
  echo "✗ Downloaded FFmpeg lacks the drawtext filter — wrong build." >&2
  exit 1
fi
