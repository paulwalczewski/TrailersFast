//! FFmpeg scene-change detection for the MCP `detect_scenes` tool.
//!
//! Runs `select='gt(scene,T)',metadata=print` over a downscaled decode and
//! parses the printed scene scores from the log. Results are cached per
//! (path, threshold) for the app session — detection decodes the whole file.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use ffmpeg_sidecar::command::FfmpegCommand;
use ffmpeg_sidecar::event::FfmpegEvent;
use serde::Serialize;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    /// Timestamp of the cut (the first frame of the new scene), seconds.
    pub time_sec: f64,
    /// How different this frame is from the previous one, 0..1.
    pub score: f64,
}

type Cache = Mutex<HashMap<(String, u32), Vec<Scene>>>;

fn cache() -> &'static Cache {
    static CACHE: OnceLock<Cache> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// Detect scene changes in `path` with the given select threshold (0..1).
/// Returns cuts in chronological order (`Scene` is `Copy`; lists are small,
/// so cache hits just clone). Blocking — run off the async runtime.
pub fn detect_scenes_blocking(path: &str, threshold: f64) -> Result<Vec<Scene>, String> {
    let key = (path.to_string(), (threshold * 100.0).round() as u32);
    if let Some(hit) = cache().lock().unwrap().get(&key) {
        return Ok(hit.clone());
    }
    crate::ensure_ffmpeg()?;

    // Downscale before scoring: scene detection compares frame deltas, which
    // survives 320px just fine and decodes several times faster than full-res.
    let filter = format!("scale=320:-2,select='gt(scene,{threshold:.2})',metadata=print");
    let iter = FfmpegCommand::new()
        .arg("-hide_banner")
        .input(path)
        .args(["-vf", &filter, "-an", "-sn", "-f", "null", "-"])
        .spawn()
        .map_err(|e| e.to_string())?
        .iter()
        .map_err(|e| e.to_string())?;

    // metadata=print logs, per selected frame:
    //   [Parsed_metadata_2 @ …] frame:12  pts:4171  pts_time:4.171
    //   [Parsed_metadata_2 @ …] lavfi.scene_score=0.456
    let mut scenes = Vec::new();
    let mut pending_time: Option<f64> = None;
    for event in iter {
        let FfmpegEvent::Log(_, msg) = event else { continue };
        if let Some(rest) = msg.split("pts_time:").nth(1) {
            pending_time = rest.split_whitespace().next().and_then(|s| s.parse().ok());
        } else if let Some(rest) = msg.split("lavfi.scene_score=").nth(1) {
            if let (Some(time_sec), Some(score)) =
                (pending_time.take(), rest.trim().parse::<f64>().ok())
            {
                scenes.push(Scene { time_sec, score });
            }
        }
    }

    cache().lock().unwrap().insert(key, scenes.clone());
    Ok(scenes)
}
