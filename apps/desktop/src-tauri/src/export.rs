//! FFmpeg export pipeline: per-input trim → normalize (scale/pad/fps/format) →
//! concat → optional animated `drawtext` intro → encode, in a single pass so
//! there is one process and one progress stream.

use base64::Engine;
use ffmpeg_sidecar::command::FfmpegCommand;
use ffmpeg_sidecar::download::auto_download;
use ffmpeg_sidecar::event::FfmpegEvent;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportClip {
    pub path: String,
    pub start_sec: f64,
    pub length_sec: f64,
    pub has_audio: bool,
    /// Per-clip framing, precomputed by the TS plan builder (mirrors the
    /// preview's `clipRenderBox`): scale → crop window → pad to canvas.
    pub scale_w: u32,
    pub scale_h: u32,
    pub crop_w: u32,
    pub crop_h: u32,
    pub crop_x: u32,
    pub crop_y: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportIntro {
    pub text: String,
    pub description: String,
    pub font_family: String,
    pub heading_weight: u32,
    pub color: String,
    pub align: String,
    pub v_align: String,
    pub animation: String,
    pub duration_sec: f64,
    pub font_size_px: u32,
    pub shadow_enabled: bool,
    pub shadow_intensity: f64,
    pub shadow_x: i64,
    pub shadow_y: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportWatermark {
    pub text: String,
    pub position: String,
    pub font_size_px: u32,
    pub color: String,
    pub opacity: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPlan {
    pub clips: Vec<ExportClip>,
    pub intro: Option<ExportIntro>,
    /// Base64 PNG of the intro (rendered by the UI, supports emoji), overlaid over time.
    pub intro_image: Option<String>,
    /// Title card over the last seconds — same mechanics as the intro.
    pub outro: Option<ExportIntro>,
    pub outro_image: Option<String>,
    pub watermark: Option<ExportWatermark>,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub crf: u32,
    pub ff_preset: String,
    pub vcodec: String,
    pub audio_kbps: u32,
    pub flip_horizontal: bool,
    pub fit_mode: String,
}

fn fmt(v: f64) -> String {
    format!("{v:.3}")
}

fn parse_time(t: &str) -> f64 {
    // "00:03:29.04" -> seconds
    let parts: Vec<&str> = t.trim().split(':').collect();
    if parts.len() != 3 {
        return 0.0;
    }
    let h: f64 = parts[0].parse().unwrap_or(0.0);
    let m: f64 = parts[1].parse().unwrap_or(0.0);
    let s: f64 = parts[2].parse().unwrap_or(0.0);
    h * 3600.0 + m * 60.0 + s
}

/// Find a usable TTF/TTC font for the intro text across platforms.
fn find_font() -> Option<String> {
    let candidates = [
        // macOS
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
        // Linux
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        // Windows
        "C:\\Windows\\Fonts\\arialbd.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
    ];
    candidates
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .map(|p| p.to_string())
}

/// Best-effort resolve the chosen font family to a font file (macOS families),
/// falling back to any available font. Export font fidelity is best-effort.
fn find_font_for(family: &str) -> Option<String> {
    let lower = family.to_lowercase();
    let map: &[(&str, &str)] = &[
        ("avenir next", "/System/Library/Fonts/Avenir Next.ttc"),
        ("avenir", "/System/Library/Fonts/Avenir.ttc"),
        ("helvetica", "/System/Library/Fonts/Helvetica.ttc"),
        ("futura", "/System/Library/Fonts/Futura.ttc"),
        ("gill sans", "/System/Library/Fonts/Supplemental/GillSans.ttc"),
        ("georgia", "/System/Library/Fonts/Supplemental/Georgia.ttf"),
        ("times new roman", "/System/Library/Fonts/Supplemental/Times New Roman.ttf"),
        ("arial", "/System/Library/Fonts/Supplemental/Arial.ttf"),
        ("verdana", "/System/Library/Fonts/Supplemental/Verdana.ttf"),
        ("trebuchet ms", "/System/Library/Fonts/Supplemental/Trebuchet MS.ttf"),
        ("courier new", "/System/Library/Fonts/Supplemental/Courier New.ttf"),
        ("impact", "/System/Library/Fonts/Supplemental/Impact.ttf"),
    ];
    for (name, path) in map {
        if lower.contains(name) && std::path::Path::new(path).exists() {
            return Some((*path).to_string());
        }
    }
    find_font()
}

/// Remove characters that would break a single-quoted drawtext value.
fn sanitize_text(t: &str) -> String {
    t.chars()
        .filter(|c| !matches!(c, '\'' | '\\' | '%' | '\n' | '\r'))
        .collect()
}

/// "#ffffff" -> "0xffffff"; falls back to white.
fn sanitize_color(c: &str) -> String {
    let hex: String = c.trim().trim_start_matches('#').chars().take(8).collect();
    if !hex.is_empty() && hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        format!("0x{hex}")
    } else {
        "0xffffff".to_string()
    }
}

#[allow(clippy::too_many_arguments)]
fn one_drawtext(
    font_arg: &str,
    text: &str,
    color: &str,
    shadow: &str,
    fontsize: &str,
    x: &str,
    y: &str,
    alpha: &str,
    d: f64,
) -> String {
    // `font_arg` is a full `font='...'` or `fontfile='...'` fragment.
    // Single-quote every expression so commas & colons don't split the graph.
    // `shadow` is a pre-built `:shadowcolor=...:shadowx=...:shadowy=...` fragment or "".
    format!(
        "drawtext={font_arg}:text='{text}':fontcolor={color}{shadow}:fontsize='{fontsize}':x='{x}':y='{y}':alpha='{alpha}':enable='between(t,0,{d:.3})'"
    )
}

/// Resolve a font family + CSS weight to an explicit font file (macOS paths),
/// preferring a bold file for bold weights, falling back to any available font.
fn font_file_for(family: &str, weight: u32) -> Option<String> {
    let bold = weight >= 700;
    let lower = family.to_lowercase();
    // (family substring, regular path, bold path) — most specific first.
    let map: &[(&str, &str, &str)] = &[
        ("avenir next", "/System/Library/Fonts/Avenir Next.ttc", "/System/Library/Fonts/Avenir Next.ttc"),
        ("avenir", "/System/Library/Fonts/Avenir.ttc", "/System/Library/Fonts/Avenir.ttc"),
        ("helvetica neue", "/System/Library/Fonts/HelveticaNeue.ttc", "/System/Library/Fonts/HelveticaNeue.ttc"),
        ("helvetica", "/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Helvetica.ttc"),
        ("futura", "/System/Library/Fonts/Supplemental/Futura.ttc", "/System/Library/Fonts/Supplemental/Futura.ttc"),
        ("gill sans", "/System/Library/Fonts/Supplemental/GillSans.ttc", "/System/Library/Fonts/Supplemental/GillSans.ttc"),
        ("arial", "/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        ("georgia", "/System/Library/Fonts/Supplemental/Georgia.ttf", "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"),
        ("times new roman", "/System/Library/Fonts/Supplemental/Times New Roman.ttf", "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf"),
        ("verdana", "/System/Library/Fonts/Supplemental/Verdana.ttf", "/System/Library/Fonts/Supplemental/Verdana Bold.ttf"),
        ("trebuchet", "/System/Library/Fonts/Supplemental/Trebuchet MS.ttf", "/System/Library/Fonts/Supplemental/Trebuchet MS Bold.ttf"),
        ("courier new", "/System/Library/Fonts/Supplemental/Courier New.ttf", "/System/Library/Fonts/Supplemental/Courier New Bold.ttf"),
        ("impact", "/System/Library/Fonts/Supplemental/Impact.ttf", "/System/Library/Fonts/Supplemental/Impact.ttf"),
    ];
    for (name, reg, bld) in map {
        if lower.contains(name) {
            let pick = if bold { bld } else { reg };
            if std::path::Path::new(pick).exists() {
                return Some((*pick).to_string());
            }
            if std::path::Path::new(reg).exists() {
                return Some((*reg).to_string());
            }
        }
    }
    find_font()
}

/// A `fontfile='...'` drawtext fragment for a family + weight (explicit path).
fn font_pattern(family: &str, weight: u32) -> String {
    let path = font_file_for(family, weight).unwrap_or_default();
    format!("fontfile='{path}'")
}

/// Build the drawtext chain (heading + optional description) for the intro,
/// animating IN over the first ~e seconds and OUT over the last ~e seconds —
/// mirroring the Remotion preview.
fn build_intro_chain(intro: &ExportIntro, w: u32, h: u32) -> String {
    let heading_font = font_pattern(&intro.font_family, intro.heading_weight);
    let desc_font = font_pattern(&intro.font_family, 400);
    let d = intro.duration_sec;
    let e = (0.4_f64).min(d * 0.3).max(0.01);
    let de = d - e;
    let fs = intro.font_size_px as f64;
    // ~6% inset so edge-aligned text isn't flush against the frame.
    let margin_x = (w as f64 * 0.06) as i64;
    let margin_y = (h as f64 * 0.06) as i64;
    let color = sanitize_color(&intro.color);

    let base_x = match intro.align.as_str() {
        "left" => format!("{margin_x}"),
        "right" => format!("w-text_w-{margin_x}"),
        _ => "(w-text_w)/2".to_string(),
    };
    // Visible immediately, fade OUT over the last ~e seconds.
    let alpha = format!("if(lt(t,{de:.3}),1,({d:.3}-t)/{e:.3})");

    let x = if intro.animation == "slideLeft" {
        format!("({base_x})+if(lt(t,{e:.3}),-220*(1-t/{e:.3}),if(lt(t,{de:.3}),0,220*((t-{de:.3})/{e:.3})))")
    } else {
        base_x
    };
    let slide_y = |by: String| -> String {
        if intro.animation == "slideUp" {
            format!("({by})+if(lt(t,{e:.3}),140*(1-t/{e:.3}),if(lt(t,{de:.3}),0,-140*((t-{de:.3})/{e:.3})))")
        } else {
            by
        }
    };
    let scale_fs = |size: f64| -> String {
        let s = size as i64;
        if intro.animation == "scale" {
            format!("{s}*(if(lt(t,{e:.3}),0.7+0.3*(t/{e:.3}),if(lt(t,{de:.3}),1,1+0.12*((t-{de:.3})/{e:.3}))))")
        } else {
            format!("{s}")
        }
    };

    let head_text = sanitize_text(&intro.text);
    let desc_text = sanitize_text(&intro.description);
    let has_desc = !desc_text.is_empty();

    let shadow = if intro.shadow_enabled {
        format!(
            ":shadowcolor=black@{:.3}:shadowx={}:shadowy={}",
            intro.shadow_intensity, intro.shadow_x, intro.shadow_y
        )
    } else {
        String::new()
    };

    // Vertical alignment of the heading (+ description) block, with edge padding.
    let desc_fs = fs * 0.42;
    let gap = fs * 0.28;
    let block_h = (fs + if has_desc { gap + desc_fs } else { 0.0 }) as i64;
    let head_y = match intro.v_align.as_str() {
        "top" => format!("{margin_y}"),
        "bottom" => format!("h-{margin_y}-{block_h}"),
        _ => format!("(h-{block_h})/2"),
    };
    let desc_y = format!("({head_y})+{}", (fs * 1.28) as i64);

    let mut chain = one_drawtext(
        &heading_font,
        &head_text,
        &color,
        &shadow,
        &scale_fs(fs),
        &x,
        &slide_y(head_y),
        &alpha,
        d,
    );
    if has_desc {
        chain.push(',');
        chain.push_str(&one_drawtext(
            &desc_font,
            &desc_text,
            &color,
            &shadow,
            &scale_fs(fs * 0.42),
            &x,
            &slide_y(desc_y),
            &alpha,
            d,
        ));
    }
    chain
}

/// Watermark drawtext shown across the whole trailer, positioned in a corner.
/// Routed through `one_drawtext` so quoting/escaping lives in one place; a huge
/// `enable` window keeps it visible for the entire clip.
fn build_watermark(wm: &ExportWatermark, font: &str, w: u32, _h: u32) -> String {
    let margin = (w as f64 * 0.03) as i64;
    let (x, y) = match wm.position.as_str() {
        "top-left" => (format!("{margin}"), format!("{margin}")),
        "top-right" => (format!("w-text_w-{margin}"), format!("{margin}")),
        "bottom-left" => (format!("{margin}"), format!("h-text_h-{margin}")),
        _ => (format!("w-text_w-{margin}"), format!("h-text_h-{margin}")),
    };
    one_drawtext(
        &format!("fontfile='{font}'"),
        &sanitize_text(&wm.text),
        &sanitize_color(&wm.color),
        "",
        &wm.font_size_px.to_string(),
        &x,
        &y,
        &format!("{:.3}", wm.opacity),
        1e9,
    )
}

/// The font to render overlays with (intro family if present, else any available).
fn resolve_overlay_font(plan: &ExportPlan) -> Option<String> {
    match &plan.intro {
        Some(intro) => find_font_for(&intro.font_family),
        None => find_font(),
    }
}

/// True when intro/watermark text is requested but this ffmpeg build can't render
/// it (no `drawtext`), so it will be dropped from the output.
pub fn overlay_will_be_skipped(plan: &ExportPlan) -> bool {
    // The intro is now an image overlay (works on any ffmpeg); only the watermark
    // still needs drawtext/freetype.
    plan.watermark.is_some() && !(has_drawtext() && resolve_overlay_font(plan).is_some())
}

/// Overlay x/y expressions for a title-card image's slide animation (0/0
/// otherwise). `t` is the time expression relative to the card's start —
/// literal "t" for the intro, "(t-START)" for the outro.
fn overlay_slide(animation: &str, e: f64, de: f64, t: &str) -> (String, String) {
    match animation {
        "slideLeft" => (
            format!("if(lt({t},{e:.3}),-(main_w*0.11)*(1-{t}/{e:.3}),if(lt({t},{de:.3}),0,(main_w*0.11)*(({t}-{de:.3})/{e:.3})))"),
            "0".to_string(),
        ),
        "slideUp" => (
            "0".to_string(),
            format!("if(lt({t},{e:.3}),(main_h*0.13)*(1-{t}/{e:.3}),if(lt({t},{de:.3}),0,-(main_h*0.13)*(({t}-{de:.3})/{e:.3})))"),
        ),
        _ => ("0".to_string(), "0".to_string()),
    }
}

/// Whether the active ffmpeg build has the `drawtext` filter (needs freetype).
/// Some builds (e.g. a minimal Homebrew ffmpeg) omit it; the intro then degrades.
/// Cached — the ffmpeg build can't change during a session.
fn has_drawtext() -> bool {
    static CACHE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *CACHE.get_or_init(|| {
        use ffmpeg_sidecar::paths::ffmpeg_path;
        std::process::Command::new(ffmpeg_path())
            .args(["-hide_banner", "-filters"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(" drawtext "))
            .unwrap_or(false)
    })
}

fn build_filter_complex(
    plan: &ExportPlan,
    silence_index: &std::collections::HashMap<usize, usize>,
    drawtext_font: Option<&str>,
    intro_img_input: Option<usize>,
    outro_img_input: Option<usize>,
) -> (String, String) {
    let n = plan.clips.len();
    let (w, h, fps) = (plan.width, plan.height, plan.fps);
    let mut fc = String::new();

    // Per-clip framing from the plan: flip FIRST (so pan coordinates match the
    // preview, which flips the positioned box in place), then scale → crop the
    // pan/zoom window → pad to the canvas (a no-op except for letterboxing).
    let flip = if plan.flip_horizontal { "hflip," } else { "" };
    for (i, c) in plan.clips.iter().enumerate() {
        let (sw, sh) = (c.scale_w.max(2), c.scale_h.max(2));
        let (cw, ch) = (c.crop_w.min(sw), c.crop_h.min(sh));
        let (cx, cy) = (c.crop_x.min(sw - cw), c.crop_y.min(sh - ch));
        fc.push_str(&format!(
            "[{i}:v]{flip}scale={sw}:{sh},crop={cw}:{ch}:{cx}:{cy},pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},format=yuv420p[v{i}];"
        ));
    }
    for i in 0..n {
        let a_in = if plan.clips[i].has_audio {
            format!("{i}:a")
        } else {
            format!("{}:a", silence_index[&i])
        };
        fc.push_str(&format!(
            "[{a_in}]aformat=sample_rates=48000:channel_layouts=stereo[a{i}];"
        ));
    }
    for i in 0..n {
        fc.push_str(&format!("[v{i}][a{i}]"));
    }
    fc.push_str(&format!("concat=n={n}:v=1:a=1[cv][ca]"));

    let mut cur = "cv".to_string();
    // Watermark: burned in with drawtext (needs freetype).
    if let (Some(font), Some(wm)) = (drawtext_font, &plan.watermark) {
        fc.push_str(&format!(";[{cur}]{}[wv]", build_watermark(wm, font, w, h)));
        cur = "wv".to_string();
    }
    // Intro: prefer the pre-rendered image (supports emoji/fonts, any ffmpeg),
    // fading out at the end; fall back to drawtext when there's no image.
    if let (Some(idx), Some(intro)) = (intro_img_input, &plan.intro) {
        let d = intro.duration_sec;
        let e = (0.4_f64).min(d * 0.3).max(0.01);
        let de = d - e;
        fc.push_str(&format!(";[{idx}:v]fade=t=out:st={de:.3}:d={e:.3}:alpha=1[introf]"));
        let (ox, oy) = overlay_slide(&intro.animation, e, de, "t");
        fc.push_str(&format!(
            ";[{cur}][introf]overlay=x='{ox}':y='{oy}':enable='between(t,0,{d:.3})'[outv]"
        ));
        cur = "outv".to_string();
    } else if let (Some(_), Some(intro)) = (drawtext_font, &plan.intro) {
        fc.push_str(&format!(";[{cur}]{}[outv]", build_intro_chain(intro, w, h)));
        cur = "outv".to_string();
    }
    // Outro: the same image-overlay mechanics, shifted to the end of the
    // trailer. setpts moves the image frames to start at T0 (otherwise the
    // overlay would consume them at t=0 and only its faded-out last frame
    // would remain by the time the enable window opens); fade in + out
    // mirrors the preview's title-card animation.
    if let (Some(idx), Some(outro)) = (outro_img_input, &plan.outro) {
        let total: f64 = plan.clips.iter().map(|c| c.length_sec).sum();
        let d = outro.duration_sec.min(total);
        let e = (0.4_f64).min(d * 0.3).max(0.01);
        let de = d - e;
        let t0 = (total - d).max(0.0);
        fc.push_str(&format!(
            ";[{idx}:v]fade=t=in:st=0:d={e:.3}:alpha=1,fade=t=out:st={de:.3}:d={e:.3}:alpha=1,setpts=PTS+{t0:.3}/TB[outrof]"
        ));
        let t_rel = format!("(t-{t0:.3})");
        let (ox, oy) = overlay_slide(&outro.animation, e, de, &t_rel);
        fc.push_str(&format!(
            ";[{cur}][outrof]overlay=x='{ox}':y='{oy}':enable='between(t,{t0:.3},{:.3})'[outrov]",
            t0 + d
        ));
        cur = "outrov".to_string();
    }
    (fc, format!("[{cur}]"))
}

/// Core export runner with a plain progress callback (fraction 0..1), so it can
/// be smoke-tested without a Tauri Channel.
pub fn run_export_inner(
    plan: &ExportPlan,
    out_path: &str,
    mut on_frac: impl FnMut(f64),
) -> Result<(), String> {
    auto_download().map_err(|e| format!("failed to obtain ffmpeg: {e}"))?;

    let n = plan.clips.len();
    if n == 0 {
        return Err("no clips to export".into());
    }
    let total: f64 = plan.clips.iter().map(|c| c.length_sec).sum();
    let drawtext_font = if has_drawtext() { resolve_overlay_font(plan) } else { None };

    // Decode the UI-rendered title-card images (support emoji + fonts) to temp PNGs.
    let decode_png = |b64: &Option<String>, name: &str| -> Option<std::path::PathBuf> {
        b64.as_ref().and_then(|b64| {
            base64::engine::general_purpose::STANDARD.decode(b64).ok().and_then(|bytes| {
                let p = std::env::temp_dir().join(format!("tf_{name}_{}.png", std::process::id()));
                std::fs::write(&p, bytes).ok().map(|_| p)
            })
        })
    };
    let intro_png = decode_png(&plan.intro_image, "intro");
    let outro_png = decode_png(&plan.outro_image, "outro");

    let mut cmd = FfmpegCommand::new();
    cmd.arg("-y").arg("-hide_banner").arg("-nostdin");

    // Real inputs, each fast-seek trimmed.
    for c in &plan.clips {
        cmd.arg("-ss")
            .arg(fmt(c.start_sec))
            .arg("-t")
            .arg(fmt(c.length_sec))
            .arg("-i")
            .arg(&c.path);
    }
    // Silence inputs for clips lacking audio (keeps concat's a=1 valid).
    let mut silence_index: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
    let mut next = n;
    for (i, c) in plan.clips.iter().enumerate() {
        if !c.has_audio {
            cmd.arg("-f")
                .arg("lavfi")
                .arg("-t")
                .arg(fmt(c.length_sec))
                .arg("-i")
                .arg("anullsrc=channel_layout=stereo:sample_rate=48000");
            silence_index.insert(i, next);
            next += 1;
        }
    }

    // Title-card image inputs (looping, bounded to each card's duration).
    let mut img_input = |png: &Option<std::path::PathBuf>, card: &Option<ExportIntro>| -> Option<usize> {
        let (png, card) = (png.as_ref()?, card.as_ref()?);
        cmd.arg("-loop")
            .arg("1")
            .arg("-t")
            .arg(fmt(card.duration_sec))
            .arg("-i")
            .arg(png.to_string_lossy().to_string());
        let idx = next;
        next += 1;
        Some(idx)
    };
    let intro_img_input = img_input(&intro_png, &plan.intro);
    let outro_img_input = img_input(&outro_png, &plan.outro);
    let _ = next;

    let (fc, vlabel) = build_filter_complex(
        plan,
        &silence_index,
        drawtext_font.as_deref(),
        intro_img_input,
        outro_img_input,
    );

    cmd.arg("-filter_complex")
        .arg(&fc)
        .arg("-map")
        .arg(vlabel.as_str())
        .arg("-map")
        .arg("[ca]")
        .arg("-c:v")
        .arg(&plan.vcodec)
        .arg("-crf")
        .arg(plan.crf.to_string())
        .arg("-preset")
        .arg(&plan.ff_preset)
        .arg("-pix_fmt")
        .arg("yuv420p");
    if plan.vcodec == "libx265" {
        cmd.arg("-tag:v").arg("hvc1");
    }
    cmd.arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg(format!("{}k", plan.audio_kbps))
        .arg("-movflags")
        .arg("+faststart")
        .arg(out_path);

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let mut last_err = String::new();
    for ev in child.iter().map_err(|e| e.to_string())? {
        match ev {
            FfmpegEvent::Progress(p) => {
                if total > 0.0 {
                    on_frac((parse_time(&p.time) / total).clamp(0.0, 1.0));
                }
            }
            FfmpegEvent::Error(e) => last_err = e,
            FfmpegEvent::Log(_, msg) => {
                if msg.to_lowercase().contains("error") {
                    last_err = msg;
                }
            }
            _ => {}
        }
    }

    match std::fs::metadata(out_path) {
        Ok(m) if m.len() > 0 => {
            on_frac(1.0);
            Ok(())
        }
        _ => Err(if last_err.is_empty() {
            "export failed (no output produced)".into()
        } else {
            format!("export failed: {last_err}")
        }),
    }
}
