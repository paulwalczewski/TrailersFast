pub mod export;

use base64::Engine;
use export::{ExportPlan, run_export_inner};
use ffmpeg_sidecar::command::FfmpegCommand;
use ffmpeg_sidecar::download::auto_download;
use ffmpeg_sidecar::event::FfmpegEvent;
use serde::Serialize;
use tauri::ipc::Channel;

/// Mirrors the TS `MediaInfo` type in @trailerfast/video-engine.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaInfo {
    duration_sec: f64,
    width: u32,
    height: u32,
    fps: f64,
    has_audio: bool,
}

/// Idempotent: downloads FFmpeg on first use, then a no-op. Blocks on first run.
fn ensure_ffmpeg() -> Result<(), String> {
    auto_download().map_err(|e| format!("failed to obtain ffmpeg: {e}"))
}

/// Spawn a fire-and-forget FFmpeg command and block until it finishes writing.
fn run_to_completion(mut cmd: FfmpegCommand) -> Result<(), String> {
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    for _ in child.iter().map_err(|e| e.to_string())? {}
    Ok(())
}

/// Run a blocking media task on the FFmpeg thread pool. Sync commands run on
/// the main thread in Tauri, so anything that spawns FFmpeg must hop off it or
/// the whole window (rendering + input) freezes for the duration.
async fn off_main_thread<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| e.to_string())?
}

/// Probe a media file by parsing `ffmpeg -i <file>` output events. Uses ffmpeg
/// (always present) rather than ffprobe (not downloaded on macOS).
#[tauri::command]
async fn probe_media(path: String) -> Result<MediaInfo, String> {
    off_main_thread(move || probe_media_blocking(&path)).await
}

fn probe_media_blocking(path: &str) -> Result<MediaInfo, String> {
    ensure_ffmpeg()?;

    let mut info = MediaInfo {
        duration_sec: 0.0,
        width: 0,
        height: 0,
        fps: 0.0,
        has_audio: false,
    };
    let mut rotated_90 = false;

    let iter = FfmpegCommand::new()
        .arg("-hide_banner")
        .input(path)
        .spawn()
        .map_err(|e| e.to_string())?
        .iter()
        .map_err(|e| e.to_string())?;

    for event in iter {
        match event {
            FfmpegEvent::ParsedInputStream(stream) => {
                if let Some(v) = stream.video_data() {
                    info.width = v.width;
                    info.height = v.height;
                    info.fps = v.fps as f64;
                }
                if stream.audio_data().is_some() {
                    info.has_audio = true;
                }
            }
            FfmpegEvent::ParsedDuration(d) => info.duration_sec = d.duration,
            // Rotation side data (e.g. phone footage): "displaymatrix: rotation
            // of -90.00 degrees". Players and FFmpeg auto-rotate on decode, so
            // report DISPLAY dimensions — swap w/h on odd multiples of 90°.
            FfmpegEvent::Log(_, msg) => {
                if let Some(rest) = msg.split("rotation of ").nth(1) {
                    let deg: f64 = rest
                        .split_whitespace()
                        .next()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(0.0);
                    if ((deg / 90.0).round() as i64).rem_euclid(2) == 1 {
                        rotated_90 = true;
                    }
                }
            }
            _ => {}
        }
    }

    if rotated_90 {
        std::mem::swap(&mut info.width, &mut info.height);
    }
    Ok(info)
}

/// Monotonic id so concurrent thumbnail jobs never share a temp file name.
static THUMB_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Extract one frame at each timestamp, scaled small, returned as base64 JPEG
/// data URIs the webview can render directly (no asset-protocol config needed).
#[tauri::command]
async fn generate_thumbnails(path: String, at_secs: Vec<f64>) -> Result<Vec<String>, String> {
    off_main_thread(move || generate_thumbnails_blocking(&path, &at_secs)).await
}

fn generate_thumbnails_blocking(path: &str, at_secs: &[f64]) -> Result<Vec<String>, String> {
    ensure_ffmpeg()?;
    let tmp = std::env::temp_dir();
    let pid = std::process::id();
    let job = THUMB_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut out = Vec::with_capacity(at_secs.len());

    for (i, t) in at_secs.iter().enumerate() {
        let outfile = tmp.join(format!("tf_thumb_{pid}_{job}_{i}.jpg"));
        let outstr = outfile.to_string_lossy().to_string();

        // -ss before -i = fast keyframe seek; single frame; scaled to 160px wide.
        let mut cmd = FfmpegCommand::new();
        cmd.arg("-y")
            .arg("-ss")
            .arg(format!("{t}"))
            .input(path)
            .arg("-frames:v")
            .arg("1")
            .arg("-vf")
            .arg("scale=160:-2")
            .arg(&outstr);
        if run_to_completion(cmd).is_err() {
            continue;
        }
        if let Ok(bytes) = std::fs::read(&outfile) {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            out.push(format!("data:image/jpeg;base64,{b64}"));
            let _ = std::fs::remove_file(&outfile);
        }
    }

    Ok(out)
}

/// Generate a small 360p proxy that IS the trimmed clip (starts at t=0), so the
/// preview plays it linearly with no seeking → smooth playback. Cached by a hash
/// of (path, start, length); returns the proxy file path.
#[tauri::command]
async fn generate_proxy(path: String, start_sec: f64, length_sec: f64) -> Result<String, String> {
    off_main_thread(move || generate_proxy_blocking(&path, start_sec, length_sec)).await
}

fn generate_proxy_blocking(path: &str, start_sec: f64, length_sec: f64) -> Result<String, String> {
    use std::hash::{Hash, Hasher};
    ensure_ffmpeg()?;

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    format!("{path}|{start_sec}|{length_sec}").hash(&mut hasher);
    let hash = hasher.finish();

    let dir = std::env::temp_dir().join("trailerfast_proxies");
    let _ = std::fs::create_dir_all(&dir);
    let out = dir.join(format!("proxy_{hash:016x}.mp4"));
    if std::fs::metadata(&out).map(|m| m.len() > 0).unwrap_or(false) {
        return Ok(out.to_string_lossy().into_owned());
    }

    let mut cmd = FfmpegCommand::new();
    cmd.arg("-y")
        .arg("-ss")
        .arg(format!("{start_sec:.3}"))
        .input(path)
        .arg("-t")
        .arg(format!("{length_sec:.3}"))
        .arg("-vf")
        .arg("scale=-2:360")
        .arg("-r")
        .arg("30")
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("ultrafast")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg("128k")
        .arg("-movflags")
        .arg("+faststart")
        .arg(out.to_string_lossy().to_string());
    run_to_completion(cmd)?;

    if std::fs::metadata(&out).map(|m| m.len() > 0).unwrap_or(false) {
        Ok(out.to_string_lossy().into_owned())
    } else {
        Err("proxy generation failed".into())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressMsg {
    fraction: f64,
    stage: String,
}

/// Run the FFmpeg trim → normalize → concat → intro → encode pipeline, streaming
/// progress back to the UI over a Tauri Channel. Returns a non-empty warning
/// string when intro/watermark text had to be dropped (ffmpeg lacks drawtext).
#[tauri::command]
async fn export_trailer(
    plan: ExportPlan,
    out_path: String,
    on_progress: Channel<ProgressMsg>,
) -> Result<String, String> {
    let warning = if export::overlay_will_be_skipped(&plan) {
        "Watermark text was skipped — this FFmpeg build has no text (drawtext) support.".to_string()
    } else {
        String::new()
    };

    tauri::async_runtime::spawn_blocking(move || {
        run_export_inner(&plan, &out_path, |fraction| {
            let _ = on_progress.send(ProgressMsg {
                fraction,
                stage: if fraction >= 1.0 { "done".into() } else { "encoding".into() },
            });
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(warning)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Phone footage stores rotation as display-matrix side data; players and
    /// FFmpeg auto-rotate, so the probe must report display dimensions.
    #[test]
    fn probe_reports_display_dims_for_rotated_video() {
        ensure_ffmpeg().unwrap();
        let dir = std::env::temp_dir();
        let plain = dir.join("tf_test_plain.mp4");
        let rotated = dir.join("tf_test_rotated.mp4");

        let mut make = FfmpegCommand::new();
        make.arg("-y")
            .arg("-f")
            .arg("lavfi")
            .input("testsrc=size=640x360:rate=30:duration=1")
            .arg("-pix_fmt")
            .arg("yuv420p")
            .arg(plain.to_string_lossy().to_string());
        run_to_completion(make).unwrap();

        let mut remux = FfmpegCommand::new();
        remux
            .arg("-y")
            .arg("-display_rotation")
            .arg("-90")
            .input(&plain.to_string_lossy())
            .arg("-c")
            .arg("copy")
            .arg(rotated.to_string_lossy().to_string());
        run_to_completion(remux).unwrap();

        let info = probe_media_blocking(&plain.to_string_lossy()).unwrap();
        assert_eq!((info.width, info.height), (640, 360));
        let info = probe_media_blocking(&rotated.to_string_lossy()).unwrap();
        assert_eq!((info.width, info.height), (360, 640));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Warm the FFmpeg download in the background so the first probe is fast.
    std::thread::spawn(|| {
        let _ = auto_download();
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            probe_media,
            generate_thumbnails,
            generate_proxy,
            export_trailer
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
