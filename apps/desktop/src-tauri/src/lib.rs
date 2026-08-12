pub mod export;
pub mod image;
pub mod mcp;
pub mod scenes;

use base64::Engine;
use std::sync::Arc;
use tauri::Manager;
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
/// Success is memoized — even the "already installed" check spawns an
/// `ffmpeg -version` subprocess, which would otherwise run per extracted frame.
pub(crate) fn ensure_ffmpeg() -> Result<(), String> {
    static READY: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    if READY.get().is_some() {
        return Ok(());
    }
    auto_download().map_err(|e| format!("failed to obtain ffmpeg: {e}"))?;
    let _ = READY.set(());
    Ok(())
}

/// Spawn a fire-and-forget FFmpeg command and block until it finishes writing.
pub(crate) fn run_to_completion(mut cmd: FfmpegCommand) -> Result<(), String> {
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    for _ in child.iter().map_err(|e| e.to_string())? {}
    Ok(())
}

/// Run a blocking media task on the FFmpeg thread pool. Sync commands run on
/// the main thread in Tauri, so anything that spawns FFmpeg must hop off it or
/// the whole window (rendering + input) freezes for the duration.
pub(crate) async fn off_main_thread<T: Send + 'static>(
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

/// Monotonic id so concurrent frame-extraction jobs never share a temp file name.
static THUMB_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Extract a single frame at `at_sec`, `width`px wide (0 = keep the source
/// width), encoded as `ext` ("jpg" or "png"). -ss before -i = fast keyframe
/// seek. Blocking; shared by the filmstrip pipeline, the thumbnail editor and
/// the MCP `get_frames` tool.
pub(crate) fn extract_frame_encoded(
    path: &str,
    at_sec: f64,
    width: u32,
    ext: &str,
) -> Result<Vec<u8>, String> {
    ensure_ffmpeg()?;
    let job = THUMB_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let outfile = std::env::temp_dir().join(format!("tf_frame_{}_{job}.{ext}", std::process::id()));

    let mut cmd = FfmpegCommand::new();
    cmd.arg("-y")
        .arg("-ss")
        .arg(format!("{at_sec}"))
        .input(path)
        .arg("-frames:v")
        .arg("1");
    if width > 0 {
        cmd.arg("-vf").arg(format!("scale={width}:-2"));
    }
    if ext == "jpg" {
        cmd.arg("-q:v").arg("4");
    }
    cmd.arg(outfile.to_string_lossy().to_string());
    run_to_completion(cmd)?;

    let bytes = std::fs::read(&outfile).map_err(|e| format!("no frame at {at_sec}s: {e}"))?;
    let _ = std::fs::remove_file(&outfile);
    Ok(bytes)
}

/// Extract a single frame as JPEG bytes, `width`px wide.
pub(crate) fn extract_frame_jpeg(path: &str, at_sec: f64, width: u32) -> Result<Vec<u8>, String> {
    extract_frame_encoded(path, at_sec, width, "jpg")
}

/// Extract one frame at each timestamp, scaled small, returned as base64 JPEG
/// data URIs the webview can render directly (no asset-protocol config needed).
#[tauri::command]
async fn generate_thumbnails(path: String, at_secs: Vec<f64>) -> Result<Vec<String>, String> {
    off_main_thread(move || generate_thumbnails_blocking(&path, &at_secs)).await
}

fn generate_thumbnails_blocking(path: &str, at_secs: &[f64]) -> Result<Vec<String>, String> {
    let mut out = Vec::with_capacity(at_secs.len());
    for t in at_secs {
        // A failed frame is skipped, keeping the rest of the strip usable.
        if let Ok(bytes) = extract_frame_jpeg(path, *t, 160) {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            out.push(format!("data:image/jpeg;base64,{b64}"));
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

fn proxy_dir() -> std::path::PathBuf {
    std::env::temp_dir().join("trailerfast_proxies")
}

/// Preview proxies survive restarts on purpose — a cache hit skips the whole
/// transcode. Nothing ever deleted them, though, so the directory grew without
/// bound. Sweep it at launch: drop anything stale, then evict oldest-first
/// until the cache is back under budget. Returns the bytes reclaimed.
fn prune_proxy_cache() -> u64 {
    const MAX_AGE: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 60 * 60);
    const MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
    prune_dir(&proxy_dir(), MAX_AGE, MAX_BYTES)
}

fn prune_dir(dir: &std::path::Path, max_age: std::time::Duration, max_bytes: u64) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    // (modified, size, path) for every proxy we can stat.
    let mut files: Vec<(std::time::SystemTime, u64, std::path::PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if path.extension()?.to_str()? != "mp4" {
                return None;
            }
            let meta = e.metadata().ok()?;
            Some((meta.modified().ok()?, meta.len(), path))
        })
        .collect();

    let now = std::time::SystemTime::now();
    let mut freed = 0u64;
    let remove = |size: u64, path: &std::path::Path, freed: &mut u64| {
        if std::fs::remove_file(path).is_ok() {
            *freed += size;
        }
    };

    // Stale first — age is a better signal than size pressure alone.
    files.retain(|(modified, size, path)| {
        let stale = now.duration_since(*modified).map(|a| a > max_age).unwrap_or(false);
        if stale {
            remove(*size, path, &mut freed);
        }
        !stale
    });

    let mut total: u64 = files.iter().map(|(_, size, _)| size).sum();
    if total > max_bytes {
        files.sort_by_key(|(modified, _, _)| *modified); // oldest first
        for (_, size, path) in &files {
            if total <= max_bytes {
                break;
            }
            let before = freed;
            remove(*size, path, &mut freed);
            total -= freed - before;
        }
    }
    freed
}

fn generate_proxy_blocking(path: &str, start_sec: f64, length_sec: f64) -> Result<String, String> {
    use std::hash::{Hash, Hasher};
    ensure_ffmpeg()?;

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    format!("{path}|{start_sec}|{length_sec}").hash(&mut hasher);
    let hash = hasher.finish();

    let dir = proxy_dir();
    let _ = std::fs::create_dir_all(&dir);
    let out = dir.join(format!("proxy_{hash:016x}.mp4"));
    if std::fs::metadata(&out).map(|m| m.len() > 0).unwrap_or(false) {
        // Touch it so the cache sweep's oldest-first eviction sees real usage
        // rather than the date the clip was first trimmed.
        if let Ok(f) = std::fs::File::options().write(true).open(&out) {
            let _ = f.set_times(std::fs::FileTimes::new().set_modified(std::time::SystemTime::now()));
        }
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

    fn write_proxy(dir: &std::path::Path, name: &str, size: usize, age_secs: u64) {
        let path = dir.join(name);
        std::fs::write(&path, vec![0u8; size]).unwrap();
        let when = std::time::SystemTime::now() - std::time::Duration::from_secs(age_secs);
        let f = std::fs::File::options().write(true).open(&path).unwrap();
        f.set_times(std::fs::FileTimes::new().set_modified(when)).unwrap();
    }

    fn names(dir: &std::path::Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    /// The proxy cache used to grow forever. The sweep must drop stale entries,
    /// then evict oldest-first down to budget — and leave fresh, in-budget
    /// proxies alone so restarts still hit the cache instead of re-transcoding.
    #[test]
    fn prunes_stale_then_evicts_oldest_over_budget() {
        let dir = std::env::temp_dir().join(format!("tf_prune_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let day = 24 * 60 * 60;
        write_proxy(&dir, "old.mp4", 100, 30 * day); // stale → always dropped
        write_proxy(&dir, "a.mp4", 100, 3 * day); // oldest fresh → evicted for budget
        write_proxy(&dir, "b.mp4", 100, 2 * day);
        write_proxy(&dir, "c.mp4", 100, 1 * day);
        write_proxy(&dir, "keep.txt", 500, 30 * day); // not ours — never touched

        // Budget of 250 leaves room for two of the three fresh 100-byte proxies.
        let freed = prune_dir(&dir, std::time::Duration::from_secs(7 * day), 250);

        assert_eq!(freed, 200, "stale old.mp4 + evicted a.mp4");
        assert_eq!(names(&dir), vec!["b.mp4", "c.mp4", "keep.txt"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A cache that already fits must survive untouched — evicting here would
    /// mean re-transcoding every clip on the next launch.
    #[test]
    fn prune_keeps_a_cache_under_budget() {
        let dir = std::env::temp_dir().join(format!("tf_prune_ok_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        write_proxy(&dir, "a.mp4", 100, 60);
        write_proxy(&dir, "b.mp4", 100, 30);

        assert_eq!(prune_dir(&dir, std::time::Duration::from_secs(7 * 24 * 3600), 1024), 0);
        assert_eq!(names(&dir), vec!["a.mp4", "b.mp4"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

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

            // Off the main thread: a large stale cache means a lot of unlink
            // syscalls, and none of it gates the first paint.
            std::thread::spawn(|| {
                let freed = prune_proxy_cache();
                if freed > 0 {
                    log::info!("pruned {} MB of stale preview proxies", freed / (1024 * 1024));
                }
            });

            // Embedded MCP server (AI integration): localhost HTTP, token-gated.
            let bridge = Arc::new(mcp::McpBridge::new(app.handle().clone()));
            let token = mcp::load_or_create_token(app.handle())?;
            app.manage(mcp::McpState::new(bridge, token));
            if mcp::load_enabled(app.handle()) {
                app.state::<mcp::McpState>().start();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            probe_media,
            generate_thumbnails,
            generate_proxy,
            export_trailer,
            image::extract_frames,
            image::image_formats,
            image::save_image,
            mcp::mcp_status,
            mcp::mcp_respond,
            mcp::mcp_set_enabled
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
