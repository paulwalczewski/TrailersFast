# 0003 — Temp staging goes through `tempfile`, never a computed path

2026-08-26

## Decision

Every intermediate file — extracted frames, thumbnail staging, decoded title-card PNGs,
the bundled-font cache — uses `tempfile::Builder`. Handles are kept as `TempPath` /
`TempDir` so the file is unlinked on drop, including on early returns.

## Why

The previous names were derived from the pid: `tf_frame_<pid>_<n>`, `tf_thumb_<pid>.png`,
`/tmp/trailersfast-fonts/`. All predictable, all in the world-writable shared temp dir, so
another local account can pre-create one as a symlink and redirect the write. The font dir
was the worst case: `path.exists()` returning true meant a planted file was handed straight
to freetype — an unsafe C parser — during export.

Two bugs fell out of the same fix: title-card PNGs were never unlinked (one leaked file per
export), and thumbnail staging keyed on pid alone, so two concurrent saves clobbered each other.

## Rule

If you find yourself writing `std::env::temp_dir().join(format!(...))`, that's the bug.
