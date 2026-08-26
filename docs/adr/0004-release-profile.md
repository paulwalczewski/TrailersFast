# 0004 — Release profile: `opt-level = "s"`, not `"z"`

2026-08-26

## Decision

`[profile.release]` in `src-tauri/Cargo.toml`: `opt-level = "s"`, `lto = true`,
`codegen-units = 1`, `panic = "abort"`, `strip = true`.

## Why

Cargo's default release profile ships full debug symbols and skips cross-crate inlining —
material for a desktop bundle whose selling point over Electron is size.

**`"s"` is deliberate over `"z"`.** `"z"` additionally disables loop vectorisation, which the
frame-extraction and preview paths depend on. The size win doesn't pay for the throughput loss.

## Consequence

`panic = "abort"` removes unwinding. A panic in an FFmpeg worker thread now takes the whole
app down instead of failing one job. Nothing currently relies on `catch_unwind`; if you add a
recovery path that does, this line has to go.

Untested at the time of writing: only `cargo check` was run, not a full `--release` build.
