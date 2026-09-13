# Trailers Fast

Desktop trailer maker: mark spots on long videos, get a short trailer.
Tauri v2 (Rust) + React 19/Vite + Remotion Player (preview) + bundled FFmpeg (export).

## Where the reasoning lives

- **`PLAN.md`** — why the stack was picked (§1 table), the web-portability seam (§2),
  the export pipeline (§6), risks incl. Remotion licensing (§10). Read §1–2 before
  proposing a stack change. Written 2026-07-06; §12 build status is behind.
- **`docs/adr/`** — decisions made *after* PLAN.md, or that supersede it. Four so far.
  Read these before touching FFmpeg resolution, the asset scope, temp files, or the
  release profile.

## Invariants that fail silently

These have no test that catches them and no error message that points at the cause:

1. **FFmpeg comes from the bundled sidecar, never `$PATH`, never the network.**
   All invocations go through `ffmpeg_bin()` / `ffmpeg_cmd()` / `ffmpeg_raw()` in `lib.rs`.
   A `$PATH` build may lack freetype → intro and watermark silently vanish from exports.
   Do not reintroduce `auto_download()`. → ADR 0001
2. **The webview's asset scope starts empty.** Files are allowed one at a time from
   `probe_media` and `generate_proxy`. A new preview path that loads a file through
   neither will 403. Widen at the choke point, not in `tauri.conf.json`. → ADR 0002
3. **No predictable paths in the shared temp dir.** Use `tempfile`. → ADR 0003
4. **Preview and export are two renderers.** Remotion draws the intro in the preview,
   FFmpeg `drawtext` draws it in the export. Any intro change must be made in both
   (`IntroTitle.tsx` and `build_intro_chain()`) or they drift. PLAN.md §10 calls this
   the top risk and it is still unmitigated — there is no snapshot test.

## Conventions

- pnpm workspaces (`pnpm@10.32.1`). Never run `npm install` — it writes a stray lockfile.
- `pnpm lint` (Biome) and `pnpm typecheck` must pass; `cargo clippy` is kept warning-free.
- Shared UI lives in `apps/desktop/src/ui/` — scrub rulers, modal headers, the pan/zoom
  editor, the overlay-text form. Reach for those before adding a second copy in a panel.
- Commits go to `main` directly; message is a sentence saying what changed for the user.
- `graphify-out/` is a derived knowledge graph, gitignored. Rebuild: `/graphify . --update`.
