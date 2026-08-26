//! Still-image support for Thumbnail mode: frame extraction for the editor and
//! encoding the composited PNG the webview hands back into the user's chosen
//! format. Everything goes through the same bundled FFmpeg the trailer uses.

use base64::Engine;

use crate::{extract_frame_encoded, off_main_thread, run_to_completion};

/// Extract frames at the given timestamps, returned as base64 data URIs the
/// webview can decode into `<img>`s. `lossless` picks PNG over JPEG — the
/// thumbnail export composites on top of these, so it can't afford JPEG rings.
#[tauri::command]
pub async fn extract_frames(
    path: String,
    at_secs: Vec<f64>,
    width: u32,
    lossless: bool,
) -> Result<Vec<String>, String> {
    off_main_thread(move || {
        let (ext, mime) = if lossless {
            ("png", "image/png")
        } else {
            ("jpg", "image/jpeg")
        };
        let mut out = Vec::with_capacity(at_secs.len());
        for t in &at_secs {
            // A failed frame is skipped, keeping the rest of the batch usable.
            if let Ok(bytes) = extract_frame_encoded(&path, *t, width, ext) {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                out.push(format!("data:{mime};base64,{b64}"));
            }
        }
        Ok(out)
    })
    .await
}

/// Read a capability list out of `ffmpeg -<what>` (stdout, so it can't go
/// through the sidecar's stderr event parser). Cached per process.
fn ffmpeg_lists(what: &'static str) -> String {
    crate::ffmpeg_raw()
        .map(|mut c| {
            c.args(["-hide_banner", what])
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
                .unwrap_or_default()
        })
        .unwrap_or_default()
}

/// The AV1 encoder to use for AVIF, if this build has one (SVT first — libaom
/// takes tens of seconds on a 4K still).
fn av1_encoder() -> Option<&'static str> {
    static CACHE: std::sync::OnceLock<Option<&'static str>> = std::sync::OnceLock::new();
    *CACHE.get_or_init(|| {
        let encoders = ffmpeg_lists("-encoders");
        // The AVIF muxer landed in ffmpeg 6; an AV1 encoder alone isn't enough.
        if !ffmpeg_lists("-muxers").contains(" avif ") {
            return None;
        }
        for enc in ["libsvtav1", "libaom-av1"] {
            if encoders.contains(enc) {
                return Some(enc);
            }
        }
        None
    })
}

fn has_webp() -> bool {
    static CACHE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *CACHE.get_or_init(|| ffmpeg_lists("-encoders").contains("libwebp"))
}

/// Image formats this FFmpeg build can actually write. PNG and JPEG are always
/// present; WebP/AVIF depend on how the binary was compiled. The probes are
/// memoized, so only the first call shells out.
pub fn available_formats() -> Vec<String> {
    let mut formats = vec!["png".to_string(), "jpeg".to_string()];
    if has_webp() {
        formats.push("webp".to_string());
    }
    if av1_encoder().is_some() {
        formats.push("avif".to_string());
    }
    formats
}

/// The export dialog only offers what `available_formats` reports.
#[tauri::command]
pub async fn image_formats() -> Result<Vec<String>, String> {
    off_main_thread(|| Ok(available_formats())).await
}

/// Write the composited thumbnail. `png_base64` is the raw base64 of a PNG (no
/// data-URI prefix) rendered by the webview at output resolution; PNG is written
/// straight to disk, anything else is transcoded by FFmpeg at `quality` (1–100).
#[tauri::command]
pub async fn save_image(
    png_base64: String,
    out_path: String,
    format: String,
    quality: u32,
) -> Result<String, String> {
    off_main_thread(move || {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(png_base64.as_bytes())
            .map_err(|e| format!("bad image data: {e}"))?;
        let quality = quality.clamp(1, 100);

        if format == "png" {
            std::fs::write(&out_path, &bytes).map_err(|e| format!("could not save: {e}"))?;
            return Ok(out_path);
        }

        // A randomly-named 0600 file in a private dir: a predictable name in the
        // shared temp dir lets another local user pre-create it as a symlink and
        // redirect this write, and keying it on the pid alone made two
        // concurrent saves clobber each other's staging file.
        let temp = tempfile::Builder::new()
            .prefix("tf_thumb_")
            .suffix(".png")
            .tempfile()
            .map_err(|e| format!("could not stage image: {e}"))?;
        std::fs::write(temp.path(), &bytes).map_err(|e| format!("could not stage image: {e}"))?;
        // Close our handle but keep the path; it is unlinked when `temp` drops,
        // including on every early return below.
        let temp = temp.into_temp_path();

        let mut cmd = crate::ffmpeg_cmd()?;
        cmd.arg("-y").input(temp.to_string_lossy().to_string());
        match format.as_str() {
            "jpeg" => {
                // FFmpeg's -q:v runs 2 (best) .. 31 (worst) — invert the slider.
                let q = 2 + ((100 - quality) * 29) / 100;
                cmd.arg("-q:v").arg(q.to_string());
            }
            "webp" => {
                if !has_webp() {
                    return Err("this FFmpeg build has no WebP encoder — try PNG or JPEG".into());
                }
                cmd.arg("-c:v")
                    .arg("libwebp")
                    .arg("-preset")
                    .arg("picture")
                    .arg("-quality")
                    .arg(quality.to_string());
            }
            "avif" => {
                let Some(encoder) = av1_encoder() else {
                    return Err("this FFmpeg build cannot write AVIF — try WebP or PNG".into());
                };
                // AV1 CRF runs 0 (best) .. 63 (worst).
                let crf = ((100 - quality) * 63) / 100;
                cmd.arg("-c:v")
                    .arg(encoder)
                    .arg("-crf")
                    .arg(crf.to_string())
                    .arg("-pix_fmt")
                    .arg("yuv420p");
                if encoder == "libaom-av1" {
                    // `-still-picture` is libaom's; SVT rejects unknown options.
                    // Default libaom speed on a 4K still is measured in minutes.
                    cmd.arg("-still-picture").arg("1").arg("-cpu-used").arg("8");
                }
            }
            other => {
                return Err(format!("unsupported image format \"{other}\""));
            }
        }
        cmd.arg(&out_path);
        run_to_completion(cmd)?;

        if std::fs::metadata(&out_path).map(|m| m.len() > 0).unwrap_or(false) {
            Ok(out_path)
        } else {
            Err(format!("FFmpeg wrote no {format} file"))
        }
    })
    .await
}
