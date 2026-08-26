# 0001 — FFmpeg is a bundled, vetted sidecar

2026-08-26 · Supersedes PLAN.md §10 and §12 (Milestone 6)

## Decision

FFmpeg is fetched at *build* time by `scripts/fetch-ffmpeg.sh`, shipped as a Tauri
`externalBin`, and resolved at runtime by `ffmpeg_bin()` in `lib.rs` — which looks only
at `<exe dir>/ffmpeg` (plus `../` for `cargo test`) and errors loudly if absent.
Every invocation goes through `ffmpeg_cmd()` or `ffmpeg_raw()`.

## Why

PLAN.md proposed `ffmpeg_sidecar::download::auto_download()` to shrink the installer, and
the code used `ffmpeg_sidecar::paths::ffmpeg_path()` to locate the binary. Two problems:

- `ffmpeg_path()` **silently falls back to a bare `ffmpeg` from `$PATH`**. A Homebrew or
  distro FFmpeg may be built without freetype. The only symptom is the intro and watermark
  quietly disappearing from the export — no error, correct-looking video.
- `auto_download()` puts an unvetted binary and a network dependency on the first-run path,
  and on macOS an unsigned downloaded binary is a Gatekeeper problem, not a solution to one.

`fetch-ffmpeg.sh` asserts the `drawtext` filter is present. Pinning resolution to the
sidecar is what makes that build-time check hold at runtime.

## Cost

Installer is larger. Accepted — offline installs work and the export is deterministic.
