# Decision records

Only for decisions where the *next* session would plausibly get it wrong — because the
reasoning isn't visible in the code, or because it contradicts `PLAN.md`.

Stack-level "why Tauri / why Remotion / why FFmpeg" lives in `PLAN.md` §1–2. Don't
duplicate it here.

| # | Decision | Supersedes |
|---|---|---|
| [0001](0001-bundled-ffmpeg-sidecar.md) | FFmpeg ships as a vetted sidecar; no runtime download, no `$PATH` | PLAN.md §10, §12 |
| [0002](0002-asset-scope-and-csp.md) | Asset scope starts empty and widens per file; explicit CSP | `tauri.conf.json` scope `**` |
| [0003](0003-tempfile-for-staging.md) | All temp staging via `tempfile` | — |
| [0004](0004-release-profile.md) | `opt-level = "s"`, `panic = "abort"` | — |

Add one when you make a call that a reasonable person would reverse without knowing why.
