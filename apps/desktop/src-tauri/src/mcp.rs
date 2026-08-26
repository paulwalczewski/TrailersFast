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
// Connected-client tracking (drives the "AI connected" UI state)
// ---------------------------------------------------------------------------

static CLIENT_COUNT: AtomicU64 = AtomicU64::new(0);

fn client_count() -> u64 {
    CLIENT_COUNT.load(Ordering::Relaxed)
}

/// One per MCP session: rmcp builds a server instance per client session and
/// drops it when the session ends, so this guard's lifetime IS the session.
/// (TrailerMcp is Clone — the Arc ensures we count sessions, not clones.)
struct SessionGuard {
    app: AppHandle,
}

impl SessionGuard {
    fn new(app: AppHandle) -> Self {
        let n = CLIENT_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = app.emit("mcp:clients", n);
        Self { app }
    }
}

impl Drop for SessionGuard {
    fn drop(&mut self) {
        // Floor at 0: guards may still drop after a server stop already reset
        // the count, and a plain fetch_sub would wrap the unsigned counter.
        let _ = CLIENT_COUNT.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
            Some(n.saturating_sub(1))
        });
        let _ = self.app.emit("mcp:clients", client_count());
    }
}

/// Hard-reset on server stop: every session died with the server, including
/// any stale one whose client vanished without closing it.
fn reset_clients(app: &AppHandle) {
    CLIENT_COUNT.store(0, Ordering::Relaxed);
    let _ = app.emit("mcp:clients", 0u64);
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
    /// Currently connected MCP client sessions.
    clients: u64,
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
        clients: client_count(),
    }
}

/// Toggle the MCP server. Off = the localhost listener stops entirely.
/// Deliberately a Tauri command (user-only), not an MCP tool — an agent must
/// not be able to keep itself connected against the user's wishes.
/// Resolves after the port is actually bound, so the returned status is final.
#[tauri::command]
pub async fn mcp_set_enabled(
    app: AppHandle,
    state: tauri::State<'_, McpState>,
    enabled: bool,
) -> Result<McpStatus, String> {
    if enabled {
        state.start();
        // start() binds asynchronously; wait (bounded) until the port is up.
        for _ in 0..80 {
            if state.port.load(Ordering::Relaxed) != 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    } else {
        state.stop();
    }
    store_enabled(&app, enabled);
    Ok(mcp_status(state))
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

/// Write a secret with owner-only permissions (0600).
///
/// `std::fs::write` creates 0644 under a typical umask, which would leave the
/// bearer token readable by every other account on the machine — defeating the
/// "random local processes can't drive the app" guarantee above. The mode is
/// set on the handle before the bytes are written, so the token is never
/// briefly world-readable on disk.
fn write_private(path: &std::path::Path, contents: &str) -> Result<(), String> {
    use std::io::Write;

    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path).map_err(|e| e.to_string())?;
    // `create` keeps the old mode if the file already existed; re-assert it.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        f.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    f.write_all(contents.as_bytes()).map_err(|e| e.to_string())
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
            // Tokens minted before the 0600 fix are on disk as 0644; tighten
            // them in place rather than leaving old installs exposed.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = std::fs::metadata(&file) {
                    if meta.permissions().mode() & 0o077 != 0 {
                        let _ = std::fs::set_permissions(
                            &file,
                            std::fs::Permissions::from_mode(0o600),
                        );
                    }
                }
            }
            return Ok(existing);
        }
    }
    let token = uuid::Uuid::new_v4().simple().to_string();
    write_private(&file, &token)?;
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
    /// Font family, e.g. "Avenir Next", "Helvetica Neue", "Futura", "Inter".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
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

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetModeParams {
    /// Which editor the window shows: "trailer" or "thumbnail".
    pub mode: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateThumbnailParams {
    /// Layout for the picked frames: "mosaic", "stripes-horizontal", "stripes-vertical" or "single".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    /// Thumbnail aspect ratio: "16:9", "9:16", "1:1", "4:5" or "4:3". Independent of the trailer's.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aspect_ratio: Option<String>,
    /// Dark wash over the frames, 0..0.8, so the title stays readable. Only painted while the thumbnail has a title.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scrim: Option<f64>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateThumbnailTitleParams {
    /// Draw the title over the thumbnail.
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
    /// Heading size in canvas pixels, 24..240 (canvas short side is 1080).
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
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddThumbnailFrameParams {
    /// Id of the source asset (from list_assets / add_assets).
    pub asset_id: String,
    /// Timestamp within the source video, in seconds.
    pub at_sec: f64,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemoveThumbnailFrameParams {
    /// Id of the picked frame (from get_project / add_thumbnail_frame).
    pub frame_id: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetThumbnailFrameTransformParams {
    /// Id of the picked frame.
    pub frame_id: String,
    /// Horizontal pan across the tile's overflow: -1 (left edge) .. 1 (right edge).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset_x: Option<f64>,
    /// Vertical pan across the tile's overflow: -1 (top) .. 1 (bottom).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset_y: Option<f64>,
    /// Zoom on top of the fit: 1..3.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom: Option<f64>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportThumbnailParams {
    /// Absolute path for the output image; its extension must match the format.
    pub output_path: String,
    /// Image format: "png" (default), "jpeg", "webp" or "avif". WebP/AVIF depend on the bundled FFmpeg build.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    /// Output short side: "720", "1080" (default) or "1440". The aspect ratio sets the other edge.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    /// Encoder quality 30..100 (default 90). Ignored for PNG.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality: Option<u32>,
}

// ---------------------------------------------------------------------------
// The MCP server itself
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct TrailerMcp {
    bridge: Arc<McpBridge>,
    _session: Arc<SessionGuard>,
}

fn tool_err(msg: String) -> McpError {
    McpError::internal_error(msg, None)
}

impl TrailerMcp {
    pub fn new(bridge: Arc<McpBridge>) -> Self {
        let session = Arc::new(SessionGuard::new(bridge.app.clone()));
        Self { bridge, _session: session }
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
    match tokio::time::timeout(limit, crate::off_main_thread(task)).await {
        Ok(result) => result.map_err(tool_err),
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

    #[tool(description = "Get the full project state: the editor mode the window is showing, settings (aspect ratio, fit mode, default clip length, flip), intro/outro cards, watermark, the ordered list of trailer clips with their source assets and framing, and the thumbnail (template, aspect ratio, title, dim, picked frames).")]
    async fn get_project(&self) -> Result<CallToolResult, McpError> {
        self.forward("get_project", json!({}), DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Switch the window between the two editors: \"trailer\" (video) or \"thumbnail\" (still image). Both share the imported assets. Switch before working on one so the user watches the right editor.")]
    async fn set_mode(
        &self,
        Parameters(p): Parameters<SetModeParams>,
    ) -> Result<CallToolResult, McpError> {
        self.forward("set_mode", p, DEFAULT_TIMEOUT).await
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
        let mut kept = scenes;
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

        // Each extraction is an independent FFmpeg seek — run them concurrently
        // (order preserved by joining in spawn order).
        let handles: Vec<_> = times
            .iter()
            .map(|t| {
                let (path, t) = (path.clone(), *t);
                tauri::async_runtime::spawn_blocking(move || crate::extract_frame_jpeg(&path, t, width))
            })
            .collect();
        let frames = tokio::time::timeout(Duration::from_secs(120), async {
            let mut out = Vec::with_capacity(handles.len());
            for h in handles {
                out.push(h.await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?);
            }
            Ok::<_, String>(out)
        })
        .await
        .map_err(|_| tool_err("frame extraction timed out after 120s".into()))?
        .map_err(tool_err)?;

        let labels = times.iter().map(|t| format!("{t:.2}s")).collect::<Vec<_>>().join(", ");
        let mut content = vec![ContentBlock::text(format!("Frames at {labels} (in order):"))];
        for bytes in frames {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            content.push(ContentBlock::image(b64, "image/jpeg"));
        }
        Ok(CallToolResult::success(content))
    }

    #[tool(description = "Configure the thumbnail's layout: which template arranges the picked frames, the output aspect ratio, and the background dim. Only the provided fields change.")]
    async fn update_thumbnail(
        &self,
        Parameters(p): Parameters<UpdateThumbnailParams>,
    ) -> Result<CallToolResult, McpError> {
        self.forward("update_thumbnail", p, DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Configure the heading + description drawn over the thumbnail. Only the provided fields change. Keep it short — a thumbnail title is read at a glance.")]
    async fn update_thumbnail_title(
        &self,
        Parameters(p): Parameters<UpdateThumbnailTitleParams>,
    ) -> Result<CallToolResult, McpError> {
        self.forward("update_thumbnail_title", p, DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Pick a frame from a source asset into the thumbnail. Frames tile in pick order, so add them in the order they should read. Returns the created frame with its id.")]
    async fn add_thumbnail_frame(
        &self,
        Parameters(p): Parameters<AddThumbnailFrameParams>,
    ) -> Result<CallToolResult, McpError> {
        self.forward("add_thumbnail_frame", p, DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Remove a picked frame from the thumbnail. The remaining frames re-tile automatically.")]
    async fn remove_thumbnail_frame(
        &self,
        Parameters(p): Parameters<RemoveThumbnailFrameParams>,
    ) -> Result<CallToolResult, McpError> {
        self.forward("remove_thumbnail_frame", p, DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Reframe a picked frame inside the tile its template gives it (pan/zoom). Offsets are normalized to the tile's overflow, so any value in -1..1 keeps the tile fully covered.")]
    async fn set_thumbnail_frame_transform(
        &self,
        Parameters(p): Parameters<SetThumbnailFrameTransformParams>,
    ) -> Result<CallToolResult, McpError> {
        self.forward("set_thumbnail_frame_transform", p, DEFAULT_TIMEOUT).await
    }

    #[tool(description = "Render the thumbnail to an image file. Blocks until the encode finishes and returns the output path. Requires at least one picked frame.")]
    async fn export_thumbnail(
        &self,
        Parameters(p): Parameters<ExportThumbnailParams>,
    ) -> Result<CallToolResult, McpError> {
        let format = p.format.clone().unwrap_or_else(|| "png".into());
        let ext = match format.as_str() {
            "png" => "png",
            "jpeg" => "jpg",
            "webp" => "webp",
            "avif" => "avif",
            other => return Err(tool_err(format!("unknown format \"{other}\""))),
        };
        if !p.output_path.to_lowercase().ends_with(&format!(".{ext}")) {
            return Err(tool_err(format!("output_path must end with .{ext} for format \"{format}\"")));
        }
        if let Some(dir) = std::path::Path::new(&p.output_path).parent() {
            if !dir.is_dir() {
                return Err(tool_err(format!("output directory does not exist: {}", dir.display())));
            }
        }
        // Available formats depend on the FFmpeg build — fail early with the list.
        if format != "png" && format != "jpeg" {
            let available = crate::image::available_formats();
            if !available.iter().any(|f| f == &format) {
                return Err(tool_err(format!(
                    "this FFmpeg build cannot write {format} — available: {}",
                    available.join(", ")
                )));
            }
        }
        self.forward("export_thumbnail", p, EXPORT_TIMEOUT).await
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
                "Trailers Fast — a desktop trailer maker with two editors that share the same \
                 imported assets: the video trailer and the thumbnail (a still image). \
                 Trailer flow: add_assets with the source video paths, get_project to see \
                 settings, update_settings (aspect ratio, clip length), then detect_scenes + \
                 get_frames to find and look at the strongest moments, add_clip for each one \
                 worth including, optionally update_intro / update_outro / update_watermark, \
                 then export_trailer. \
                 Thumbnail flow: set_mode(\"thumbnail\") so the user sees what you're building, \
                 update_thumbnail to choose a template (mosaic / horizontal or vertical stripes / \
                 single) and aspect ratio, add_thumbnail_frame for each moment worth showing \
                 (they tile in pick order — use get_frames first to judge them), \
                 set_thumbnail_frame_transform to reframe a tile, update_thumbnail_title for the \
                 heading, then export_thumbnail. \
                 The app shows every change live, so the user watches the work assemble; every \
                 tool call is undoable in-app."
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

    let app = bridge.app.clone();
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
    reset_clients(&app);
}
