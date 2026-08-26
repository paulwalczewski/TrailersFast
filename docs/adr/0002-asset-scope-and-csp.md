# 0002 — The webview gets no standing filesystem access

2026-08-26 · Supersedes `assetProtocol.scope: ["**"]`

## Decision

`tauri.conf.json` ships `assetProtocol.scope: []` and an explicit CSP allowlist
(`object-src 'none'`, `frame-ancestors 'none'`, `freezePrototype: true`).
Access is granted one file at a time by `allow_asset()`, called from exactly two places:

- `probe_media` — every ingested source file is probed here, once. User-picked.
- `generate_proxy` — the preview proxy, a file we wrote ourselves.

## Why

The scope was `**`: read access to the entire disk for anything running in the webview.
Those two commands are the natural choke points — a path reaching either is already either
user-chosen or ours, so narrowing costs nothing at runtime.

## The failure mode to expect

**A new preview surface that loads a file through neither command will 403 with no useful
error.** The fix is to call `allow_asset()` at that path's choke point. It is *not* to widen
the static scope in `tauri.conf.json` — that throws the whole decision away.

Same for CSP: media playback needs `asset: http://asset.localhost blob: data:` on both
`img-src` and `media-src`. If preview goes blank after a CSP edit, check those first.
