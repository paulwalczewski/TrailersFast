# Trailers Fast — Comprehensive Build Plan

> A desktop-first (web-portable) app to turn many long videos into a short trailer by
> clicking spots on a timeline. Native now via Tauri; the same React UI ships to the web later.
>
> _Plan compiled 2026-07-06 from dedicated research on Tauri vs Electron, Remotion fit,
> HeroUI v3 theming, and the FFmpeg export pipeline. Source URLs are cited inline._

---

## 1. Executive summary — the recommended stack

| Layer | Choice | Why |
|---|---|---|
| **Native shell** | **Tauri v2** (Rust) | ~2.5–10 MB installer vs Electron's ~80–150 MB; ~30–80 MB RAM vs ~150–300 MB; deny-by-default security; native FS + sidecar binaries. Uses the OS WebView. |
| **Frontend** | **React 19 + Vite + TypeScript** | Vite is what both Tauri and a future web build use → near drop-in web port. |
| **UI kit** | **HeroUI v3** (Tailwind CSS v4 + React Aria) | Requested. v3 is current; theming via `oklch` CSS variables. |
| **Timeline & preview** | **Remotion Player** (`@remotion/player` + `@remotion/media` `<Video>`) | Client-side React preview, **no Node/Chromium**. Frame-accurate, works identically on desktop & web. |
| **Export engine** | **Native FFmpeg** via the **`ffmpeg-sidecar`** Rust crate | Trim + concat of existing footage is near-instant with FFmpeg; no C toolchain, no bundled Chromium, no Node. |
| **Extras** | `@dnd-kit` (clip reordering), custom timeline component, `zustand` (state), **`pnpm` workspaces** (monorepo) | HeroUI has no timeline/DnD/upload/canvas components — these fill the gaps. Turborepo intentionally skipped for now (see below). |

**The single most important architectural decision:** _Remotion for preview, FFmpeg for export._
Remotion excels at generative (React → video) work, but this app's bulk job is trimming and
concatenating **already-encoded** footage — exactly where FFmpeg's stream-copy concat is dramatically
faster than re-rendering every frame through headless Chrome (Remotion's `OffthreadVideo` is officially
"not optimized" for this). Remotion's real strength — React compositing — is needed **only** for the
animated text intro, and even that we reproduce in FFmpeg `drawtext` to keep the bundle Chromium-free.

Sources: <https://v2.tauri.app/develop/sidecar/> · <https://www.remotion.dev/docs/player> ·
<https://www.remotion.dev/docs/performance> · <https://crates.io/crates/ffmpeg-sidecar> ·
<https://www.gethopp.app/blog/tauri-vs-electron>

---

## 2. Web-portability strategy (the "native now, web later" requirement)

Everything hinges on **never calling `invoke()` / Tauri APIs from UI components.** Instead, all
media work goes through one abstract interface, and only the implementation swaps per target:

```ts
// packages/video-engine — the seam between UI and platform
interface VideoEngine {
  probe(file: FileRef): Promise<MediaInfo>;                 // ffprobe: duration/res/fps/audio
  thumbnails(file: FileRef, atSecs: number[]): Promise<Url[]>;
  export(project: Project, opts: ExportOpts): AsyncIterable<Progress>;
  pickFiles(): Promise<FileRef[]>;
}
```

| Target | Implementation | Media path |
|---|---|---|
| **Desktop (now)** | `TauriVideoEngine` | `invoke()` → Rust `#[tauri::command]` → `ffmpeg-sidecar` |
| **Web (later)** | `WebVideoEngine` | (a) server API running FFmpeg, **or** (b) `ffmpeg.wasm` for light client-side edits |

Because the timeline model, preset builder, Remotion `<Player>` composition, HeroUI theme, and all
components are platform-agnostic, **shipping web = writing one adapter + a backend**, not re-porting the app.

> Note: `ffmpeg.wasm` is ~12–25× slower than native and needs COOP/COEP headers — fine as a
> web fallback for light edits, not a reason to use it on desktop. (<https://ffmpegwasm.netlify.app/docs/performance/>)

---

## 3. Monorepo layout

```
trailerfast/
├─ package.json                 # pnpm workspaces (Turborepo optional, added later if builds slow)
├─ packages/
│  ├─ core/                     # pure TS, zero platform deps
│  │   ├─ model.ts              #   Project, Asset, ClipMarker, IntroConfig, ExportOpts
│  │   ├─ timeline.ts           #   click→clip logic, ordering, total-duration math
│  │   └─ ffmpeg-args.ts        #   builds FFmpeg arg arrays from the model (engine-agnostic)
│  ├─ video-engine/             # VideoEngine interface + shared types
│  │   ├─ index.ts              #   interface + DI factory
│  │   ├─ tauri.ts              #   TauriVideoEngine  → invoke()
│  │   └─ web.ts                #   WebVideoEngine    (later)
│  └─ state/                    # zustand store (project state, selection, settings)
└─ apps/
   ├─ desktop/                  # Tauri v2 app
   │   ├─ src/                  #   App + panels + theme (see M1 note) + engine injection
   │   │   └─ panels/           #   AssetsTab, ClipLengthTab, IntroTab, WorkArea, Sidebar
   │   └─ src-tauri/            #   Rust: commands + ffmpeg-sidecar
   │       ├─ binaries/ffmpeg-<target-triple>   # bundled FFmpeg (externalBin)
   │       └─ capabilities/default.json         # shell:allow-execute for the sidecar
   └─ web/                      # (later) Vite app; mounts same <App/> + WebVideoEngine
```

**Rules that keep the port cheap:**
1. No component imports `@tauri-apps/api` — only `video-engine`.
2. The timeline/edit model lives in `core` as plain data; both `<Player>` (preview) and
   `ffmpeg-args` (export) consume it, so the same edit yields the same output on desktop and web.
3. Prefer `ffmpeg-sidecar` over native `ffmpeg-next` bindings — no C toolchain, painless Windows builds,
   built-in progress parsing and binary download. (<https://crates.io/crates/ffmpeg-sidecar>)

---

## 4. UI / UX layout

Matches the requested layout: **left sidebar (tabbed) · right work area (source timeline + trailer preview + export)**.
Theme: **light blue + white**, light mode only (v1).

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Trailers Fast                                                    ● ● ●     │
├───────────────────────────┬──────────────────────────────────────────────┤
│  SIDEBAR (tabs)            │  WORK AREA                                    │
│  ┌─ Assets ─┬ Clips ─┬ Intro ─┐   ┌─ Trailer preview (Remotion Player) ─┐ │
│  │                       │   │   │        ▶  final clips stitched        │ │
│  │  [▣] clip_01.mp4      │   │   │     (updates live as you mark)        │ │
│  │  [ ] clip_02.mov      │   │   └──────────────────────────────────────┘ │
│  │  [▣] clip_03.mp4      │   │   ┌─ SOURCE TIMELINE ────────────────────┐ │
│  │  + Add videos…        │   │   │ ▓clip01▓▓▓│▓▓clip03▓▓▓│  (selected)   │ │
│  │                       │   │   │   ↑marked  ↑marked  (click to mark)   │ │
│  └───────────────────────┘   │   └──────────────────────────────────────┘ │
│                              │            [  ⬇ Export Trailer  ]  (CTA)    │
└───────────────────────────┴──────────────────────────────────────────────┘
```

### Sidebar — Tab 1: **Assets**
- **Add videos** via Tauri file dialog (`plugin-dialog`) — HeroUI has no upload component, so a
  styled trigger + Tauri dialog (drag-drop optional via Tauri's file-drop event).
- On import, `ffprobe` each file → duration, resolution, fps, audio; generate a poster thumbnail.
- Each asset renders as a HeroUI **Card** with a **Checkbox in the corner** (requested). Checking an
  asset adds it (full length) to the source timeline; unchecking removes it and its clip markers.
- Long lists get `@tanstack/react-virtual`.

### Sidebar — Tab 2: **Clip length**
- HeroUI **Slider** + **NumberField**, default **3 seconds**, bound to `settings.defaultClipLengthSec`.
- New clip markers inherit this length. (Design choice below: changing it can either update only
  future markers or retroactively re-size existing ones — see Open Questions.)

### Sidebar — Tab 3: **Intro** (optional)
- Toggle **Enable intro**. When on, fields: **text** (Input/TextArea), **font** (Autocomplete over a
  bundled font list), **alignment** (left/center/right ToggleButton), **font size** (NumberField),
  **color** (HeroUI ColorPicker), **animation** (Select), **duration** (default ~2–3 s).
- Animations to ship (must look identical in Player preview *and* FFmpeg export — keep them simple):
  **Fade**, **Slide-in (from left/bottom)**, **Scale/zoom-in** — each also animates *out* at the end.
- If filled in, the intro plays over the **first few seconds** of the trailer and animates out.

### Work area — **Source timeline** (right, top-of-stack)
- Renders all **selected** assets laid end-to-end **in full**, as a filmstrip (thumbnail strip per asset)
  with a playhead and a time ruler. Asset boundaries are visually delimited.
- **Click to mark:** clicking at time `T` creates a clip **centered** on the cursor — `[T - len/2, T + len/2]`
  — highlighted as a colored region on the strip. **Near an edge** (asset/timeline boundary) the clip is
  **clamped** so it stays fully in bounds: a click within `len/2` of the start anchors from the start
  (`[0, len]`), and within `len/2` of the end anchors to the end (`[end - len, end]`). Multiple clicks →
  multiple markers; each inherits the clip-length setting; markers are hoverable/removable.
- The **final trailer = the marked clips concatenated in the order they were clicked**, with the intro
  prepended if enabled. The user can **reorder clips via drag-and-drop** on the timeline (`@dnd-kit`),
  which updates each marker's `order`.

### Work area — **Trailer preview** (right, top)
- A **Remotion `<Player>`** rendering the composition: intro `<Sequence>` (if enabled) + a `<Series>` of
  `@remotion/media` `<Video>` clips, each with `trimBefore`/`trimAfter` (frame units) from the markers.
  Scrubbable, updates live as markers change. (<https://www.remotion.dev/docs/series>, <https://www.remotion.dev/docs/media/video>)

### Work area — **Export** (primary CTA)
- Opens a HeroUI **Modal** with the export options below and a **progress bar** during encode.

---

## 5. Data model (`packages/core/model.ts`)

```ts
type Asset = {
  id: string; path: string; fileName: string;
  durationSec: number; width: number; height: number; fps: number;
  hasAudio: boolean; posterUrl: string; filmstripUrls: string[];
  selected: boolean;                       // the checkbox
};

type ClipMarker = {
  id: string; assetId: string;
  startSec: number;                        // within the asset
  lengthSec: number;                       // inherited from settings at creation
  order: number;                           // position in the final trailer
};

type IntroConfig = {
  enabled: boolean; text: string;
  fontFamily: string; fontSizePx: number; color: string;
  align: "left" | "center" | "right";
  animation: "fade" | "slideLeft" | "slideUp" | "scale";
  durationSec: number;                     // ~2–3s
};

type ExportOpts = {
  preset: "full-4k" | "full-1080" | "standard-1080" | "standard-720" | "low-720" | "low-480";
  codec: "h264" | "hevc" | "av1";          // h264 default
  container: "mp4";
};

type Settings = { defaultClipLengthSec: number /* =3 */ };
type Project = { assets: Asset[]; markers: ClipMarker[]; intro: IntroConfig; settings: Settings };
```

---

## 6. Export pipeline (FFmpeg)

Because clips come from **different source videos** (different res/fps/codec/sample-rate), we use the
robust **"normalize-then-concat"** two-stage approach, then a final transcode per chosen preset. This
lets the user re-export at another quality without re-trimming.

**Stage 0 — probe (at import):** `ffprobe` each asset for res/fps/codec/audio; pick a master canvas
(e.g. 1920×1080@30 or the max of selected assets).

**Stage 1 — trim + normalize each marker → identical intermediate clips.** Frame-accurate cut with
`-ss` **before** `-i` + `-t` (fast seek that still decodes to the exact frame when re-encoding), plus
scale/pad/setsar/fps/format + audio normalization so Stage 2 can stream-copy:

```bash
ffmpeg -ss 00:00:12.000 -i input.mp4 -t 3.000 \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p" \
  -af "aformat=sample_rates=48000:channel_layouts=stereo" \
  -c:v libx264 -preset veryfast -crf 18 -c:a aac -b:a 192k \
  -avoid_negative_ts make_zero -movflags +faststart  clip_001.mp4
```
> Why re-encode (not `-c copy`) here: inter-frame codecs can only cut cleanly on keyframes, so
> stream-copy would snap the cut to the wrong timestamp. Re-encoding gives frame accuracy **and**
> makes every clip identical for a clean concat. (<https://trac.ffmpeg.org/wiki/Concatenate>,
> <https://www.ffmpeg-micro.com/blog/ffmpeg-ss-t-to-seeking>)

**Stage 1b — intro** (if enabled): render it as the first normalized clip via `drawtext` with
time-based expressions (kept in parity with the Remotion preview). Examples:

```
# Fade in (0→0.5s), hold, fade out (end-0.5s→end)
drawtext=fontfile=…:text='My Trailer':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=(h-text_h)/2:\
  alpha='if(lt(t,0.5),t/0.5, if(lt(t,2.5),1, if(lt(t,3),(3-t)/0.5,0)))'
# Slide-in from left over first 1s
…:x='if(lt(t,1), -text_w+(w/2+text_w/2)*(t/1), (w-text_w)/2)'
```
(<https://ffmpeg.org/ffmpeg-filters.html#drawtext>) The intro can be its own short clip prepended to the
`concat` list, or `overlay`ed on the first clip's opening seconds.

**Stage 2 — concat (instant, lossless):**
```bash
ffmpeg -f concat -safe 0 -i files.txt -c copy master.mp4      # files.txt lists clip_001.mp4 …
```

**Stage 3 — final transcode per export preset** (scale + quality + codec):

| User option | `-vf scale` | CRF | preset | audio |
|---|---|---|---|---|
| Full quality — 4K | `-2:2160` | 18 | slow | 256k |
| Full quality — 1080p | `-2:1080` | 18 | slow | 192k |
| Standard — 1080p | `-2:1080` | 21 | medium | 192k |
| Standard — 720p | `-2:720` | 22 | medium | 160k |
| Lower — 720p | `-2:720` | 26 | veryfast | 128k |
| Lower — 480p | `-2:480` | 28 | veryfast | 96k |

Always `-pix_fmt yuv420p` (universal playback) + `-movflags +faststart`. **H.264/libx264** is the
default codec (plays everywhere); **HEVC** and **AV1 (svt-av1)** offered as opt-in "smaller file".
CRF ±6 ≈ half/double file size; ~18 is visually lossless. (<https://slhck.info/video/2017/02/24/crf-guide.html>,
<https://trac.ffmpeg.org/wiki/Encode/H.264>)

**Progress bar:** run encodes with `-progress pipe:1 -nostats`, parse `out_time_us`, compute
`percent = 100 * out_time_us/1e6 / total_duration`. Weight across stages (each clip = its share of total).
⚠️ **Gotcha:** the field named `out_time_ms` is actually **microseconds** — divide by 1,000,000. Use
`out_time_us` to avoid the trap. (<https://blog.programster.org/ffmpeg-output-progress-to-file>)

---

## 7. HeroUI v3 light-blue/white theme

HeroUI v3 (current, released Mar 2026) drops the v2 `heroui()` plugin + semantic tokens in favor of
**Tailwind v4 + `oklch` CSS variables**, and needs **no provider**. Requires React 19 + Tailwind v4.

```bash
npm i @heroui/styles @heroui/react     # + Tailwind v4
```
```css
/* packages/ui/theme/theme.css — order matters */
@import "tailwindcss";
@import "@heroui/styles";

:root, [data-theme="light"] {
  --background: oklch(1 0 0);              /* pure white page      */
  --surface:    oklch(1 0 0);              /* white cards          */
  --accent:     oklch(0.72 0.12 240);     /* light blue brand/CTA */
  --focus:      var(--accent);
}
```
Set `<html class="light" data-theme="light">` and `<body class="bg-background text-foreground">`.
Components in use: **Tabs** (vertical sidebar), **Card + Checkbox** (assets), **Slider + NumberField**
(clip length), **Select / Autocomplete / ToggleButton / ColorPicker / Input** (intro), **Button**
(CTA), **Modal + ProgressBar** (export). Verified working on plain Vite + React 19 (no SSR needed).
(<https://heroui.com/en/docs/react/getting-started/theming>, <https://heroui.com/en/docs/react/getting-started/quick-start>)

> There is a v2 fallback (Tailwind v3, `heroui()` plugin, `<HeroUIProvider>`, `color="primary"`) if
> React 19 / Tailwind 4 causes friction with any dependency — but v3 is recommended for a new app.

---

## 8. Installed skills (for execution)

Already installed into this project so the implementing agent has authoritative, current docs:

| Skill | Source | Purpose |
|---|---|---|
| `remotion-best-practices` | **remotion-dev/skills** (official, 410K) | Remotion Player, `<Series>`, media tags, interpolate/spring |
| `heroui-react` | **heroui-inc/heroui** (official) | HeroUI v3 components + oklch theming |
| `vercel-react-best-practices` | **vercel-labs** (527K) | React 19 performance patterns |
| `ffmpeg` | digitalsamba/claude-code-video-toolkit | FFmpeg trim/scale/concat/overlay recipes |
| `tauri-v2` | nodnarbnitram/claude-code-extensions | Tauri v2 commands, sidecar, capabilities |

---

## 9. Implementation milestones

1. **Scaffold** — pnpm-workspaces monorepo; Tauri v2 + Vite + React 19 + TypeScript; HeroUI v3 with the
   light-blue/white theme; app shell + sidebar/work-area split.
2. **FFmpeg plumbing** — bundle FFmpeg as sidecar (`externalBin` + capability); `ffmpeg-sidecar` in Rust;
   `probe`/`thumbnails` commands; `VideoEngine` interface + `TauriVideoEngine`.
3. **Assets tab** — file dialog import, ffprobe metadata, thumbnails, Card+Checkbox selection, state.
4. **Source timeline** — filmstrip of selected assets end-to-end, ruler/playhead, **click-to-mark**,
   marker rendering/removal, clip-length inheritance.
5. **Trailer preview** — Remotion `<Player>` composition (`<Series>` of `<Video>` clips), live updates.
6. **Clip length + Intro tabs** — settings binding; intro fields; Remotion intro `<Sequence>` with the
   3–4 animations (interpolate/spring).
7. **Intro export parity** — mirror the animations in FFmpeg `drawtext`; verify preview↔export match.
8. **Export** — modal with preset matrix; Stage 1–3 pipeline in Rust; `-progress` bar; save dialog.
9. **Polish & packaging** — icons, empty states, errors; macOS/Windows build, code-sign & **notarize
   (incl. the bundled ffmpeg binary on macOS)**, auto-update.
10. **Web target (later)** — `apps/web` Vite app mounting the same `<App/>` + `WebVideoEngine`
    (server FFmpeg or `ffmpeg.wasm`).

---

## 10. Risks & mitigations

- **Intro preview↔export parity** — the one place two renderers (Remotion preview vs FFmpeg drawtext)
  can diverge. _Mitigation:_ ship only simple, well-tested animations (fade/slide/scale); pin identical
  timing/easing; snapshot-test. If richer motion is ever needed, fall back to pre-rendering the intro
  with Remotion's renderer (reintroduces Node+Chromium for that one segment only).
- **WebKit rendering (Tauri uses the OS WebView)** — the Remotion `<Player>` canvas may render subtly
  differently on macOS WebKit vs Windows WebView2. _Mitigation:_ test the Player on WebKit early (M1).
- **Bundled FFmpeg signing/notarization on macOS** — the sidecar binary must be signed & notarized or
  Gatekeeper blocks it. _Mitigation:_ handle in the packaging milestone.
  ~~`auto_download()` at first run~~ — rejected 2026-08-26, see `docs/adr/0001`.
- **Large-file / many-clip performance** — Stage-1 re-encode is the cost; _mitigation:_ parallelize
  per-clip across CPU cores, cache intermediates, keep concat as stream-copy.
- **Remotion licensing** — Player-only (no Remotion *rendering*) means no per-render fees; but a
  company of **4+ employees still needs a license** (seat-based "Creators" ~$25/seat/mo). ≤3 employees is
  free. Using FFmpeg for export deliberately keeps us off the per-render "Automators" plan.
  (<https://www.remotion.pro/license>)

---

## 11. Open questions (product decisions for you)

1. ~~**Click-to-mark anchor**~~ — ✅ **Decided:** click **centers** the clip on the cursor; **clamp** to
   start/end when clicked within `len/2` of a boundary so the clip stays fully in bounds.
2. **Changing clip length** — should it retroactively resize existing markers, or only apply to new ones
   (proposed default: only new; existing keep their length)?
3. ~~**Trailer clip order**~~ — ✅ **Decided:** **click order**, with **drag-and-drop reordering** on the
   timeline (`@dnd-kit`) updating each marker's `order`.
4. **Overlapping markers** on the same asset — allow, or snap/prevent overlap?
5. **Audio** — keep each clip's original audio (proposed), mute, or support a music track over the trailer?
6. **Transitions between clips** — hard cuts only for v1 (proposed), or basic crossfades?

Remaining defaults (2, 4, 5, 6) are baked into the plan; tell me which to change and I'll adjust before scaffolding.

---

## 12. Build status

### ✅ Milestone 1 — Scaffold + themed shell (done)
- **Monorepo** via pnpm workspaces: `packages/core`, `packages/video-engine`, `packages/state`, `apps/desktop`.
- **Stack live:** Tauri v2 (Rust) + Vite 8 + React 19.2 + TypeScript + HeroUI v3.2 (Tailwind v4) + zustand 5.
- **Light-blue/white theme** applied via oklch overrides in `apps/desktop/src/index.css`.
- **Shell UI:** header + left sidebar with the 3 tabs (Assets / Clip length / Intro) + right work area
  (trailer-preview placeholder, source-timeline strip, Export CTA). Wired to the zustand store; the
  clip-length slider, asset checkboxes, and intro form are functional.
- **Platform seam:** `VideoEngine` interface with `TauriVideoEngine`; UI never imports Tauri directly.
  Rust side exposes placeholder `probe_media` / `generate_thumbnails` / `export_trailer` commands + the
  dialog plugin, so the native shell is clickable ahead of the FFmpeg work.
- **Verified:** `tsc --noEmit` ✓, `vite build` ✓, `cargo check` ✓.

> **M1 note on UI location:** the React UI (App, panels, theme) currently lives in `apps/desktop/src`
> rather than a separate `packages/ui`. This was a deliberate call to keep the first build simple
> (avoids cross-package Tailwind-v4 content-scanning + React-dedup setup). The UI extracts to
> `packages/ui` in the web-target milestone (§9.10), which is a file-move + one `@source` line — the
> shared logic seam (`core`/`state`/`video-engine`) already lives in packages, so portability is intact.

### ✅ Milestone 2 — FFmpeg plumbing (done)
- **`ffmpeg-sidecar` v2.5** crate added; `auto_download()` fetched FFmpeg on first use
  _(superseded 2026-08-26 — FFmpeg now ships as a bundled `externalBin`; `docs/adr/0001`)_
  (warmed in a background thread at startup). No system FFmpeg required. Bundling FFmpeg via
  `externalBin` for the shipped installer is deferred to the packaging milestone.
- **`probe_media`** — real metadata via FFmpeg event parsing (`ParsedInputStream` → width/height/fps +
  audio detection; `ParsedDuration` → seconds). Chosen over ffprobe because ffprobe isn't downloaded on
  macOS, whereas ffmpeg always is.
- **`generate_thumbnails`** — fast keyframe seek (`-ss` before `-i`) → one scaled frame per timestamp,
  returned as base64 JPEG **data URIs** (no asset-protocol capability needed).
- **Frontend wired:** importing a video probes it, shows real resolution/fps/duration on the asset card
  with a poster, and fills an 8-frame **filmstrip** along the source timeline (fire-and-forget so cards
  appear instantly).
- **Verified:** `tsc --noEmit` ✓, `cargo check` ✓, and a runtime smoke test through real FFmpeg
  (generate 1920×1080@30/3s sample → probe returned exactly that + audio; thumbnail wrote a valid JPEG).

### ✅ Milestone 3 — Source-timeline marking + Remotion preview (done)
- **Click-to-mark:** clicking an asset block on the source timeline marks a clip **centered** on the
  cursor, **clamped** to the asset bounds (`core/timeline.ts:centeredClip`). Markers render as accent
  overlays sized/positioned by in-point + length; click a marker to remove it.
- **Trailer strip:** the marked clips list in **click order**, with **drag-to-reorder** via `@dnd-kit`
  (`horizontalListSortingStrategy`) updating each marker's `order`, plus per-clip remove.
- **Remotion preview:** a `@remotion/player` `<Player>` renders `TrailerComposition` — a `<Series>` of
  `@remotion/media` `<Video>` clips with `trimBefore`/`trimAfter` in frames (1920×1080@30, `objectFit:
  contain`). Duration is computed from clip frames; empty state shows a placeholder.
- **Local video sourcing:** `VideoEngine.toPlayableUrl()` → Tauri `convertFileSrc`; the **asset protocol
  is enabled** in `tauri.conf.json` (`app.security.assetProtocol`, dev scope `**`) so the webview can
  load local files. (Tighten the scope in the packaging milestone.)
- **Verified:** `tsc --noEmit` ✓, `vite build` ✓ (Remotion + dnd-kit bundle), `cargo check` ✓.
  Note: actual video *playback* in the Player needs a real file + the running app — confirm via `pnpm dev`.

### ✅ Milestone 4 — Intro preview (done)
- **`IntroTitle`** Remotion component: full-screen title driven by the Intro tab (text, font, size, color,
  alignment), animating IN over the first ~0.4s and OUT over the last ~0.4s via `interpolate` keyframes.
- **4 animations:** `fade` (opacity), `slideLeft` (translateX ±220), `slideUp` (translateY ±140),
  `scale` (0.7→1→1.12) — using individual transform props per Remotion guidance, no CSS transitions.
- **Overlay semantics:** the intro is a `<Sequence>` overlaid on the first frames of the trailer (does
  NOT extend its length), clamped to the trailer duration. Shown only when enabled + non-empty text.
- **Verified:** `tsc --noEmit` ✓, `vite build` ✓. (Visual confirmation needs the running app.)

> Export-side **FFmpeg `drawtext` parity** for these 4 animations is deferred to the export milestone,
> where the same enter/hold/exit keyframe timings get mirrored as `drawtext` alpha/x/y expressions.

### ✅ Milestone 5 — Export pipeline (done)
- **Export dialog:** quality preset matrix (Full/Standard/Lower × 4K/1080/720/480) + codec (H.264 / H.265),
  a native save dialog, and a live **progress bar**.
- **Single-pass FFmpeg** (`src-tauri/src/export.rs`): per-input fast-seek trim (`-ss`/`-t`) → normalize
  (scale + pad + setsar + fps + `yuv420p`) → `concat` filter → optional `drawtext` intro → encode
  (libx264/libx265, CRF + preset from the table, `+faststart`). Clips lacking audio get an `anullsrc`
  track so concat stays valid. One process → one progress stream.
- **Progress** streamed to the UI via a **Tauri `Channel`**, parsed from ffmpeg's own progress events.
- **Shared logic:** `core/export-plan.ts` resolves presets → concrete encode params and builds the
  platform-agnostic `ExportPlan` (reused by a future web backend).
- **Fixed:** enabling the asset protocol (M3) required the **`protocol-asset`** feature on the `tauri`
  crate — added.
- **Verified:** `tsc --noEmit` ✓, `vite build` ✓, `cargo check` ✓, and a **runtime smoke test through
  real FFmpeg** — 3 clips (incl. one silent) trimmed/normalized/concatenated → a valid **1280×720, 8s**
  MP4 with progress 0→100%.

> **Intro-text caveat:** burning the intro text needs a **freetype-enabled** ffmpeg (`drawtext`). The dev
> machine's Homebrew ffmpeg lacks it, so the export **degrades gracefully** (video exports fine, intro
> text is skipped). The packaging milestone will bundle a freetype ffmpeg so intro burn-in works
> everywhere; the `drawtext` alpha/x/y/fontsize expressions mirror the Remotion preview animations.

### ▶ Milestone 6 — Packaging & polish (in progress)
- ✅ Bundle a freetype-enabled FFmpeg via `externalBin` — `docs/adr/0001`
- ✅ Tighten the asset-protocol scope (+ explicit CSP) — `docs/adr/0002`
- ☐ Code-sign & notarize (incl. the ffmpeg binary) for macOS/Windows
- ☐ Empty/error states + app icons
