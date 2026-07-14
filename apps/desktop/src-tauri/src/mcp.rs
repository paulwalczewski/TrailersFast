//! Embedded MCP server: lets local AI agents (Claude Code, Claude Desktop, …)
//! drive the app over Streamable HTTP on localhost.
//!
//! Architecture: project state lives in the webview's zustand store, so every
//! tool call is forwarded there — the tool handler emits an `mcp:request`
//! event, the frontend dispatcher executes it against the store and replies
//! via the `mcp_respond` command, which resolves the pending oneshot here.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rmcp::{
    ErrorData as McpError, ServerHandler,
    handler::server::wrapper::Parameters,
    model::*,
    schemars,
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    },
    tool, tool_handler, tool_router,
};
use base64::Engine as _;
use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

/// Ports tried in order; the first one that binds wins (shown in the AI modal).
const PORT_RANGE: std::ops::Range<u16> = 4823..4843;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
/// Probing many files spawns FFmpeg per file — give imports headroom.
const INGEST_TIMEOUT: Duration = Duration::from_secs(300);
/// A full encode of a long trailer can legitimately take minutes.
const EXPORT_TIMEOUT: Duration = Duration::from_secs(900);

// ---------------------------------------------------------------------------
// Bridge: Rust tool call -> webview store -> response
// ---------------------------------------------------------------------------

pub struct McpBridge {
    app: AppHandle,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    seq: AtomicU64,
}

impl McpBridge {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            pending: Mutex::new(HashMap::new()),
            seq: AtomicU64::new(1),
        }
    }

    async fn call(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.seq.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);

        let emitted = self
            .app
            .emit("mcp:request", json!({ "id": id, "method": method, "params": params }))
            .map_err(|e| format!("app window unavailable: {e}"));
        if let Err(e) = emitted {
            self.pending.lock().unwrap().remove(&id);
            return Err(e);
        }

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("app closed while handling the request".into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("`{method}` timed out after {}s — is the app responsive?", timeout.as_secs()))
            }
        }
    }

    pub fn resolve(&self, id: u64, result: Result<Value, String>) {
        if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(result);
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri-managed state + commands used by the frontend
// ---------------------------------------------------------------------------

pub struct McpState {
    pub bridge: Arc<McpBridge>,
    pub token: String,
    /// Bound port, 0 while the server isn't running.
    pub port: Arc<AtomicU16>,
    /// Present while the server is (starting or) running; dropping it stops it.
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
}

impl McpState {
    pub fn new(bridge: Arc<McpBridge>, token: String) -> Self {
        Self {
            bridge,
            token,
            port: Arc::new(AtomicU16::new(0)),
            shutdown: Mutex::new(None),
        }
    }

    /// Idempotent start; also recovers from a dead server (port 0, stale sender).
    pub fn start(&self) {
        let mut guard = self.shutdown.lock().unwrap();
        if guard.is_some() && self.port.load(Ordering::Relaxed) != 0 {
            return;
        }
        let (tx, rx) = oneshot::channel();
        *guard = Some(tx);
        tauri::async_runtime::spawn(serve(
            self.bridge.clone(),
            self.token.clone(),
            self.port.clone(),
            rx,
        ));
    }

    pub fn stop(&self) {
        // Dropping the sender resolves the shutdown future in serve().
        self.shutdown.lock().unwrap().take();
    }

    fn enabled(&self) -> bool {
        self.shutdown.lock().unwrap().is_some()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    enabled: bool,
    running: bool,
    port: u16,
    url: String,
    token: String,
}

#[tauri::command]
pub fn mcp_status(state: tauri::State<McpState>) -> McpStatus {
    let port = state.port.load(Ordering::Relaxed);
    McpStatus {
        enabled: state.enabled(),
        running: port != 0,
        port,
        url: format!("http://127.0.0.1:{port}/mcp"),
        token: state.token.clone(),
    }
}

/// Toggle the MCP server. Off = the localhost listener stops entirely.
/// Deliberately a Tauri command (user-only), not an MCP tool — an agent must
/// not be able to keep itself connected against the user's wishes.
#[tauri::command]
pub fn mcp_set_enabled(
    app: AppHandle,
    state: tauri::State<McpState>,
    enabled: bool,
) -> McpStatus {
    if enabled {
        state.start();
    } else {
        state.stop();
    }
    store_enabled(&app, enabled);
    mcp_status(state)
}

/// Persisted toggle state, default on.
pub fn load_enabled(app: &AppHandle) -> bool {
    app.path()
        .app_data_dir()
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join("mcp_enabled")).ok())
        .map(|s| s.trim() != "0")
        .unwrap_or(true)
}

fn store_enabled(app: &AppHandle, enabled: bool) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::write(dir.join("mcp_enabled"), if enabled { "1" } else { "0" });
    }
}

/// The frontend dispatcher's reply to an `mcp:request` event.
#[tauri::command]
pub fn mcp_respond(
    state: tauri::State<McpState>,
    id: u64,
    result: Option<Value>,
    error: Option<String>,
) {
    let outcome = match error {
        Some(e) => Err(e),
        None => Ok(result.unwrap_or(Value::Null)),
    };
    state.bridge.resolve(id, outcome);
}

/// Stable per-install bearer token so a saved client config keeps working
/// across app restarts, while random local processes can't drive the app.
pub fn load_or_create_token(app: &AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("mcp_token");
    if let Ok(existing) = std::fs::read_to_string(&file) {
        let existing = existing.trim().to_string();
        if !existing.is_empty() {
            return Ok(existing);
        }
    }
    let token = uuid::Uuid::new_v4().simple().to_string();
    std::fs::write(&file, &token).map_err(|e| e.to_string())?;
    Ok(token)
}

// ---------------------------------------------------------------------------
// Tool parameter types (schemars doc comments become the tool schema)
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddAssetsParams {
    /// Absolute paths of video files to import (mp4, mov, m4v, webm, mkv, avi).
    pub paths: Vec<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemoveAssetParams {
    /// Id of the asset to remove from the project (its clips are removed too).
    pub asset_id: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsParams {
    /// Default length for newly marked clips, in seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_clip_length_sec: Option<f64>,
    /// Mirror every clip horizontally.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flip_horizontal: Option<bool>,
    /// Output aspect ratio: "16:9", "9:16", "1:1", "4:5" or "4:3".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aspect_ratio: Option<String>,
    /// How clips fill the canvas: "cover" (crop to fill) or "contain" (letterbox).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fit_mode: Option<String>,
}

/// Shared by update_intro and update_outro — the cards have identical fields.
#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TitleCardParams {
    /// Show this title card.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Heading line.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Optional description line below the heading.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Font family, e.g. "Avenir Next", "Helvetica Neue", "Futura", "Inter".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    /// Heading weight: 400, 500, 600, 700 or 800.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading_weight: Option<u32>,
    /// Heading size in canvas pixels (canvas short side is 1080).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size_px: Option<u32>,
    /// Text color as hex, e.g. "#ffffff".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Horizontal alignment: "left", "center" or "right".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<String>,
    /// Vertical alignment: "top", "middle" or "bottom".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub v_align: Option<String>,
    /// Entrance animation: "fade", "slideLeft", "slideUp" or "scale".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub animation: Option<String>,
    /// How long the card stays on screen, in seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_sec: Option<f64>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWatermarkParams {
    /// Show a text watermark across the whole trailer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Watermark text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Corner: "top-left", "top-right", "bottom-left" or "bottom-right".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
    /// Size in canvas pixels.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size_px: Option<u32>,
    /// Color as hex, e.g. "#ffffff".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Opacity 0..1.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddClipParams {
    /// Id of the source asset (from list_assets / add_assets).
    pub asset_id: String,
    /// In-point within the source video, in seconds.
    pub start_sec: f64,
    /// Clip length in seconds; defaults to the project's default clip length.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length_sec: Option<f64>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateClipParams {
    /// Id of the clip (from get_project / add_clip).
    pub clip_id: String,
    /// New in-point within the source video, in seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_sec: Option<f64>,
    /// New clip length in seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length_sec: Option<f64>,
    /// New position in the trailer (0-based index).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemoveClipParams {
    /// Id of the clip to remove.
    pub clip_id: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetClipTransformParams {
    /// Id of the clip to reframe.
    pub clip_id: String,
    /// Horizontal pan across the clip's overflow: -1 (left edge) .. 1 (right edge), 0 = centered.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset_x: Option<f64>,
    /// Vertical pan across the clip's overflow: -1 (top edge) .. 1 (bottom edge), 0 = centered.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset_y: Option<f64>,
    /// Extra zoom on top of the fit, 1..3.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom: Option<f64>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DetectScenesParams {
    /// Id of the source asset to analyze.
    pub asset_id: String,
    /// Scene-change sensitivity 0.1..0.9 — lower finds more cuts. Default 0.3.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub threshold: Option<f64>,
    /// Return at most this many cuts (highest-scoring kept). Default 30, max 100.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_scenes: Option<u32>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetFramesParams {
    /// Id of the source asset.
    pub asset_id: String,
    /// Timestamps (seconds) to extract, max 10 per call.
    pub times_sec: Vec<f64>,
    /// Frame width in px, 128..1024. Default 512.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportTrailerParams {
    /// Absolute path for the output .mp4 file.
    pub output_path: String,
    /// Quality preset: "full-4k", "full-1080", "standard-1080" (default), "standard-720", "low-720" or "low-480".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
    /// Video codec: "h264" (default, plays everywhere) or "hevc" (smaller file).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codec: Option<String>,
}

// ---------------------------------------------------------------------------
// The MCP server itself
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct TrailerMcp {
    bridge: Arc<McpBridge>,
}

fn tool_err(msg: String) -> McpError {
    McpError::internal_error(msg, None)
}

impl TrailerMcp {
    pub fn new(bridge: Arc<McpBridge>) -> Self {
        Self { bridge }
    }

    /// Forward a tool call to the webview and wrap its JSON reply.
    async fn forward(
        &self,
        method: &str,
        params: impl Serialize,
        timeout: Duration,
    ) -> Result<CallToolResult, McpError> {
        let params = serde_json::to_value(params).map_err(|e| tool_err(e.to_string()))?;
        let value = self.bridge.call(method, params, timeout).await.map_err(tool_err)?;
        let text = serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string());
        Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
    }

    /// Look up an asset's on-disk path + duration in the webview store.
    async fn resolve_asset(&self, asset_id: &str) -> Result<(String, f64), McpError> {
        let value = self
            .bridge
            .call("resolve_asset", json!({ "assetId": asset_id }), DEFAULT_TIMEOUT)
            .await
            .map_err(tool_err)?;
        let path = value["path"].as_str().unwrap_or_default().to_string();
        let duration = value["durationSec"].as_f64().unwrap_or(0.0);
        if path.is_empty() {
            return Err(tool_err(format!("asset {asset_id} has no resolvable path")));
        }
        Ok((path, duration))
    }
}

/// Run blocking FFmpeg work off the async runtime, with a hard cap.
async fn blocking<T: Send + 'static>(
    limit: Duration,
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, McpError> {
    let fut = tauri::async_runtime::spawn_blocking(task);
    match tokio::time::timeout(limit, fut).await {
        Ok(Ok(result)) => result.map_err(tool_err),
        Ok(Err(join)) => Err(tool_err(join.to_string())),
        Err(_) => Err(tool_err(format!("analysis timed out after {}s", limit.as_secs()))),
    }
}

#[tool_router]
impl TrailerMcp {
    #[tool(description = "List the source videos imported into the project, with ids, dimensions, duration and whether they're selected for the trailer.")]
    async fn list_assets(&self) -> Result<CallToolResult, McpError> {
        self.forward("list_assets", json!({}), DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Import video files into the project by absolute path. Returns each asset's id, dimensions, duration and fps once probed. Thumbnails keep generating in the background.")]
    async fn add_assets(
        &self,
        Parameters(p): Parameters<AddAssetsParams>,
    ) -> Result<CallToolResult, McpError> {
        if p.paths.is_empty() {
            return Err(tool_err("paths is empty".into()));
        }
        let missing: Vec<&String> =
            p.paths.iter().filter(|p| !std::path::Path::new(p.as_str()).is_file()).collect();
        if !missing.is_empty() {
            return Err(tool_err(format!("files not found: {missing:?}")));
        }
        self.forward("add_assets", p, INGEST_TIMEOUT).await
    }

    #[tool(description = "Remove an imported asset from the project, along with any trailer clips that use it.")]
    async fn remove_asset(
        &self,
        Parameters(p): Parameters<RemoveAssetParams>,
    ) -> Result<CallToolResult, McpError> {
        self.forward("remove_asset", p, DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Get the full project state: settings (aspect ratio, fit mode, default clip length, flip), intro/outro cards, watermark, and the ordered list of trailer clips with their source assets and framing.")]
    async fn get_project(&self) -> Result<CallToolResult, McpError> {
        self.forward("get_project", json!({}), DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Update project settings. Only the provided fields change. The user sees changes live in the preview.")]
    async fn update_settings(
        &self,
        Parameters(p): Parameters<UpdateSettingsParams>,
    ) -> Result<CallToolResult, McpError> {
        self.forward("update_settings", p, DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Configure the intro title card shown over the first seconds of the trailer. Only the provided fields change.")]
    async fn update_intro(
        &self,
        Parameters(p): Parameters<TitleCardParams>,
    ) -> Result<CallToolResult, McpError> {
        self.forward("update_intro", p, DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Configure the outro title card shown over the last seconds of the trailer (same fields as the intro). Only the provided fields change.")]
    async fn update_outro(
        &self,
        Parameters(p): Parameters<TitleCardParams>,
    ) -> Result<CallToolResult, McpError> {
        self.forward("update_outro", p, DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Configure the text watermark overlaid on the whole trailer. Only the provided fields change.")]
    async fn update_watermark(
        &self,
        Parameters(p): Parameters<UpdateWatermarkParams>,
    ) -> Result<CallToolResult, McpError> {
        self.forward("update_watermark", p, DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Add a clip to the trailer: a segment of a source asset starting at start_sec. Appends at the end of the trailer. Returns the created clip with its id.")]
    async fn add_clip(
        &self,
        Parameters(p): Parameters<AddClipParams>,
    ) -> Result<CallToolResult, McpError> {
        self.forward("add_clip", p, DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Change a trailer clip's in-point, length, or position in the trailer.")]
    async fn update_clip(
        &self,
        Parameters(p): Parameters<UpdateClipParams>,
    ) -> Result<CallToolResult, McpError> {
        self.forward("update_clip", p, DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Remove a clip from the trailer.")]
    async fn remove_clip(
        &self,
        Parameters(p): Parameters<RemoveClipParams>,
    ) -> Result<CallToolResult, McpError> {
        self.forward("remove_clip", p, DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Reframe a clip within the trailer canvas (pan/zoom). Offsets are normalized to the clip's overflow, so any value in -1..1 keeps the canvas fully covered — black bars are impossible.")]
    async fn set_clip_transform(
        &self,
        Parameters(p): Parameters<SetClipTransformParams>,
    ) -> Result<CallToolResult, McpError> {
        self.forward("set_clip_transform", p, DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Detect scene changes (cuts) in a source asset with FFmpeg. Returns cut timestamps with change scores 0..1, chronological. Use them as candidate clip in-points — clips starting at a cut look intentional. Combine with get_frames to see what each scene shows.")]
    async fn detect_scenes(
        &self,
        Parameters(p): Parameters<DetectScenesParams>,
    ) -> Result<CallToolResult, McpError> {
        let (path, duration_sec) = self.resolve_asset(&p.asset_id).await?;
        let threshold = p.threshold.unwrap_or(0.3).clamp(0.1, 0.9);
        let max_scenes = p.max_scenes.unwrap_or(30).clamp(1, 100) as usize;

        let scenes =
            blocking(Duration::from_secs(300), move || crate::scenes::detect_scenes_blocking(&path, threshold))
                .await?;

        // Keep the strongest cuts when over budget, but report chronologically.
        let mut kept: Vec<_> = scenes.iter().copied().collect();
        let total = kept.len();
        if kept.len() > max_scenes {
            kept.sort_by(|a, b| b.score.total_cmp(&a.score));
            kept.truncate(max_scenes);
            kept.sort_by(|a, b| a.time_sec.total_cmp(&b.time_sec));
        }

        let result = json!({
            "assetDurationSec": duration_sec,
            "totalCutsFound": total,
            "scenes": kept,
            "hint": "Timestamps are where a new scene begins. The segment between two cuts is one continuous shot.",
        });
        let text = serde_json::to_string_pretty(&result).unwrap_or_else(|_| result.to_string());
        Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
    }

    #[tool(description = "Extract frames from a source asset at the given timestamps, returned as images in the same order. Look at them to judge which moments belong in the trailer and how to frame them. Max 10 timestamps per call.")]
    async fn get_frames(
        &self,
        Parameters(p): Parameters<GetFramesParams>,
    ) -> Result<CallToolResult, McpError> {
        if p.times_sec.is_empty() {
            return Err(tool_err("timesSec is empty".into()));
        }
        if p.times_sec.len() > 10 {
            return Err(tool_err("max 10 timestamps per call — batch the rest".into()));
        }
        let (path, duration_sec) = self.resolve_asset(&p.asset_id).await?;
        let width = p.width.unwrap_or(512).clamp(128, 1024);
        let times: Vec<f64> = p
            .times_sec
            .iter()
            .map(|t| t.clamp(0.0, (duration_sec - 0.05).max(0.0)))
            .collect();

        let frames = blocking(Duration::from_secs(120), {
            let times = times.clone();
            move || {
                times
                    .iter()
                    .map(|t| crate::extract_frame_jpeg(&path, *t, width))
                    .collect::<Result<Vec<_>, _>>()
            }
        })
        .await?;

        let labels = times.iter().map(|t| format!("{t:.2}s")).collect::<Vec<_>>().join(", ");
        let mut content = vec![ContentBlock::text(format!("Frames at {labels} (in order):"))];
        for bytes in frames {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            content.push(ContentBlock::image(b64, "image/jpeg"));
        }
        Ok(CallToolResult::success(content))
    }

    #[tool(description = "Render the trailer to an .mp4 file with FFmpeg. Blocks until the encode finishes and returns the output path. Requires at least one clip.")]
    async fn export_trailer(
        &self,
        Parameters(p): Parameters<ExportTrailerParams>,
    ) -> Result<CallToolResult, McpError> {
        if !p.output_path.ends_with(".mp4") {
            return Err(tool_err("output_path must end with .mp4".into()));
        }
        if let Some(dir) = std::path::Path::new(&p.output_path).parent() {
            if !dir.is_dir() {
                return Err(tool_err(format!("output directory does not exist: {}", dir.display())));
            }
        }
        self.forward("export_trailer", p, EXPORT_TIMEOUT).await
    }
}

#[tool_handler]
impl ServerHandler for TrailerMcp {
    fn get_info(&self) -> ServerInfo {
        // from_build_env() would report the rmcp crate's own name — identify as us.
        let mut server_info = Implementation::from_build_env();
        server_info.name = "trailers-fast".into();
        server_info.version = env!("CARGO_PKG_VERSION").into();
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(server_info)
            .with_instructions(
                "Trailers Fast — a desktop trailer maker. Typical flow: add_assets with the \
                 source video paths, get_project to see settings, update_settings (aspect \
                 ratio, clip length), then detect_scenes + get_frames to find and look at the \
                 strongest moments, add_clip for each one worth including, optionally update_intro / \
                 update_outro / update_watermark, then export_trailer. The app shows every change live, so \
                 the user watches the trailer assemble; every tool call is undoable in-app."
                    .to_string(),
            )
    }
}

// ---------------------------------------------------------------------------
// HTTP serving
// ---------------------------------------------------------------------------

/// Bind the first free port in PORT_RANGE and serve MCP on /mcp until the
/// shutdown sender is dropped (toggle off) or the app exits.
async fn serve(
    bridge: Arc<McpBridge>,
    token: String,
    port_out: Arc<AtomicU16>,
    shutdown: oneshot::Receiver<()>,
) {
    use axum::response::IntoResponse;

    let mut listener = None;
    for port in PORT_RANGE {
        match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(l) => {
                listener = Some((l, port));
                break;
            }
            Err(_) => continue,
        }
    }
    let Some((listener, port)) = listener else {
        log::error!("MCP server: no free port in {PORT_RANGE:?}");
        return;
    };

    // The cancel token tears down open sessions (SSE streams) on shutdown —
    // without it, graceful shutdown would wait on idle streams forever.
    let cancel = tokio_util::sync::CancellationToken::new();
    let service = StreamableHttpService::new(
        move || Ok(TrailerMcp::new(bridge.clone())),
        LocalSessionManager::default().into(),
        StreamableHttpServerConfig::default().with_cancellation_token(cancel.child_token()),
    );

    let expected = format!("Bearer {token}");
    let router = axum::Router::new().nest_service("/mcp", service).layer(
        axum::middleware::from_fn(move |req: axum::extract::Request, next: axum::middleware::Next| {
            let expected = expected.clone();
            async move {
                let ok = req
                    .headers()
                    .get(axum::http::header::AUTHORIZATION)
                    .and_then(|v| v.to_str().ok())
                    .map(|v| v == expected)
                    .unwrap_or(false);
                if ok {
                    next.run(req).await
                } else {
                    axum::http::StatusCode::UNAUTHORIZED.into_response()
                }
            }
        }),
    );

    port_out.store(port, Ordering::Relaxed);
    log::info!("MCP server listening on http://127.0.0.1:{port}/mcp");
    let result = axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            // Resolves on send OR when the sender is dropped (McpState::stop).
            let _ = shutdown.await;
            cancel.cancel();
        })
        .await;
    if let Err(e) = result {
        log::error!("MCP server stopped: {e}");
    } else {
        log::info!("MCP server stopped (disabled)");
    }
    port_out.store(0, Ordering::Relaxed);
}
