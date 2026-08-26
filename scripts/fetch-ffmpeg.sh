#!/usr/bin/env bash
#
# Fetch a full, freetype-enabled FFmpeg for the current platform and place it as
# a Tauri sidecar binary at apps/desktop/src-tauri/binaries/ffmpeg-<target-triple>.
#
# The bundled FFmpeg ships inside the app installer, so users never need their own
# — and it has the `drawtext` filter required to burn in the intro + watermark.
# Run this once before `pnpm tauri build` (and in CI). The binary is git-ignored.
#
# Usage: scripts/fetch-ffmpeg.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/apps/desktop/src-tauri/binaries"
TRIPLE="$(rustc -vV | sed -n 's/host: //p')"
OUT="$DEST/ffmpeg-$TRIPLE"
mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Target triple: $TRIPLE"

case "$TRIPLE" in
  aarch64-apple-darwin)
    # osxexperts full arm64 build (freetype/fontconfig/harfbuzz); needs a browser UA.
    curl -fsSL -A "Mozilla/5.0" -o "$TMP/ff.zip" "https://www.osxexperts.net/ffmpeg80arm.zip"
    unzip -o "$TMP/ff.zip" -d "$TMP" >/dev/null
    cp "$TMP/ffmpeg" "$OUT"
    ;;
  x86_64-apple-darwin)
    # evermeet full x86_64 build (freetype/fontconfig/harfbuzz).
    curl -fsSL -o "$TMP/ff.zip" "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip"
    unzip -o "$TMP/ff.zip" -d "$TMP" >/dev/null
    cp "$TMP/ffmpeg" "$OUT"
    ;;
  x86_64-unknown-linux-gnu)
    # John Van Sickle static build (freetype/fontconfig).
    curl -fsSL -o "$TMP/ff.tar.xz" "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
    tar -xf "$TMP/ff.tar.xz" -C "$TMP"
    cp "$TMP"/ffmpeg-*-amd64-static/ffmpeg "$OUT"
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
else
  echo "✗ Downloaded FFmpeg lacks the drawtext filter — wrong build." >&2
  exit 1
fi
