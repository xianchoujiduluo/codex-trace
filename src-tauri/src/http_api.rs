use std::convert::Infallible;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::compression::CompressionLayer;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

use crate::state::AppState;
use crate::watcher::{start_picker_watcher, start_session_watcher};

#[derive(Clone)]
pub struct HttpState {
    pub app_state: Arc<AppState>,
    pub app: Option<AppHandle>,
}

pub const DEFAULT_HTTP_HOST: &str = "127.0.0.1";
pub const DEFAULT_HTTP_PORT: u16 = 11424;
const MAX_FRONTEND_HTML_BYTES: usize = 20 * 1024 * 1024;
const FRONTEND_DOWNLOAD_ATTEMPTS: usize = 4;
static FRONTEND_UPDATE_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Debug, Serialize)]
pub(crate) struct FrontendUpdateResponse {
    updated: bool,
    bytes: usize,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum FrontendUpdateError {
    #[error("frontend update is not configured: {0}")]
    Configuration(String),
    #[error("failed to download frontend: {0}")]
    Download(String),
    #[error("failed to install frontend: {0}")]
    Install(String),
}

impl FrontendUpdateError {
    fn status(&self) -> axum::http::StatusCode {
        match self {
            Self::Configuration(_) => axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Self::Download(_) => axum::http::StatusCode::BAD_GATEWAY,
            Self::Install(_) => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

fn pick_host(raw: Option<String>) -> String {
    raw.filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_HTTP_HOST.to_string())
}

fn pick_port(raw: Option<String>) -> u16 {
    raw.and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(DEFAULT_HTTP_PORT)
}

pub fn resolve_bind_addr() -> (String, u16) {
    (
        pick_host(std::env::var("CODEXTRACE_HTTP_HOST").ok()),
        pick_port(std::env::var("CODEXTRACE_HTTP_PORT").ok()),
    )
}

pub fn resolve_static_dir() -> Option<String> {
    std::env::var("CODEXTRACE_STATIC_DIR")
        .ok()
        .filter(|s| !s.is_empty())
}

/// Start the HTTP server from a Tauri AppHandle (desktop/web mode).
pub async fn start_http_server(app: AppHandle) {
    let app_state: Arc<AppState> = app.state::<Arc<AppState>>().inner().clone();
    run_server(Arc::new(HttpState {
        app_state,
        app: Some(app),
    }))
    .await;
}

/// Start the HTTP server without Tauri (headless mode).
pub async fn start_http_server_headless(state: Arc<AppState>) {
    run_server(Arc::new(HttpState {
        app_state: state,
        app: None,
    }))
    .await;
}

async fn run_server(state: Arc<HttpState>) {
    let api_router = Router::new()
        .route("/api/settings", get(api_get_settings))
        .route("/api/settings/dir", post(api_set_sessions_dir))
        .route("/api/frontend/update", post(api_update_frontend))
        .route("/api/sessions", post(api_discover_sessions))
        .route("/api/session/load", post(api_load_session))
        .route("/api/session/download", get(api_download_session))
        .route("/api/session/status", post(api_session_status))
        .route("/api/session/watch", post(api_watch_session))
        .route("/api/session/unwatch", post(api_unwatch_session))
        .route("/api/picker/watch", post(api_watch_picker))
        .route("/api/picker/unwatch", post(api_unwatch_picker))
        // Compress finite JSON responses. The SSE route is merged below deliberately so its
        // event flushes are never delayed by a compression buffer.
        .layer(CompressionLayer::new());

    let mut router = api_router
        .merge(Router::new().route("/api/events", get(api_events)))
        .layer(CorsLayer::permissive());

    if let Some(dir) = resolve_static_dir() {
        let serve = ServeDir::new(&dir).append_index_html_on_directories(true);
        router = router.fallback_service(serve);
        eprintln!("HTTP API: serving static assets from {dir}");
    }

    let router = router.with_state(state);

    let (host, port) = resolve_bind_addr();
    let addr = format!("{host}:{port}");
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("HTTP API: failed to bind {addr}: {e}");
            return;
        }
    };
    eprintln!("HTTP API: listening on http://{addr}");

    if let Err(e) = axum::serve(listener, router).await {
        eprintln!("HTTP API: server error: {e}");
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn app_state(state: &HttpState) -> &AppState {
    &state.app_state
}

fn err_response(status: axum::http::StatusCode, msg: String) -> Response {
    (status, Json(serde_json::json!({ "error": msg }))).into_response()
}

fn ok_json<T: serde::Serialize>(val: &T) -> Response {
    Json(val).into_response()
}

fn session_load_error_status(msg: &str) -> axum::http::StatusCode {
    if msg == crate::commands::session::NO_SESSION_PATH_PROVIDED {
        axum::http::StatusCode::BAD_REQUEST
    } else {
        axum::http::StatusCode::INTERNAL_SERVER_ERROR
    }
}

fn percent_encode_filename(filename: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(filename.len());
    for byte in filename.as_bytes() {
        if (*byte).is_ascii_alphanumeric() || matches!(*byte, b'.' | b'-' | b'_') {
            encoded.push(*byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }
    encoded
}

fn download_content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("jsonl") => "application/x-ndjson",
        Some("zst") => "application/zstd",
        _ => "application/octet-stream",
    }
}

#[derive(Deserialize)]
struct DownloadSessionQuery {
    path: String,
}

async fn api_download_session(Query(query): Query<DownloadSessionQuery>) -> Response {
    if query.path.is_empty() {
        return err_response(
            axum::http::StatusCode::BAD_REQUEST,
            crate::commands::session::NO_SESSION_PATH_PROVIDED.to_string(),
        );
    }

    let path = Path::new(&query.path);
    let file = match tokio::fs::File::open(path).await {
        Ok(file) => file,
        Err(error) => {
            return err_response(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                error.to_string(),
            )
        }
    };
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("session.jsonl");
    let disposition = format!(
        "attachment; filename*=UTF-8''{}",
        percent_encode_filename(filename)
    );

    Response::builder()
        .status(axum::http::StatusCode::OK)
        .header(
            axum::http::header::CONTENT_TYPE,
            download_content_type(path),
        )
        .header(axum::http::header::CONTENT_DISPOSITION, disposition)
        .header(axum::http::header::CACHE_CONTROL, "no-store")
        .body(axum::body::Body::from_stream(
            tokio_util::io::ReaderStream::new(file),
        ))
        .unwrap_or_else(|error| {
            err_response(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                error.to_string(),
            )
        })
}

fn validate_frontend_html(html: &[u8]) -> Result<(), FrontendUpdateError> {
    if html.is_empty() {
        return Err(FrontendUpdateError::Download(
            "downloaded file is empty".to_string(),
        ));
    }

    let text = std::str::from_utf8(html).map_err(|_| {
        FrontendUpdateError::Download("downloaded file is not valid UTF-8".to_string())
    })?;
    let lowercase = text.to_ascii_lowercase();
    if !lowercase.contains("<!doctype html") && !lowercase.contains("<html") {
        return Err(FrontendUpdateError::Download(
            "downloaded file is not a valid HTML document".to_string(),
        ));
    }

    Ok(())
}

fn build_frontend_http_client(
    proxy_url: Option<&str>,
) -> Result<reqwest::Client, FrontendUpdateError> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 10 {
                attempt.error("too many redirects")
            } else if attempt.url().scheme() != "https" {
                attempt.error("redirected to a non-HTTPS URL")
            } else {
                attempt.follow()
            }
        }));

    if let Some(proxy_url) = proxy_url.filter(|value| !value.is_empty()) {
        let proxy = reqwest::Proxy::all(proxy_url).map_err(|error| {
            FrontendUpdateError::Configuration(format!(
                "invalid CODEXTRACE_FRONTEND_PROXY: {error}"
            ))
        })?;
        builder = builder.proxy(proxy);
    }

    builder
        .build()
        .map_err(|e| FrontendUpdateError::Download(e.to_string()))
}

async fn download_frontend_html(
    url: &str,
    proxy_url: Option<&str>,
) -> Result<Vec<u8>, FrontendUpdateError> {
    let url = reqwest::Url::parse(url)
        .map_err(|e| FrontendUpdateError::Configuration(format!("invalid URL: {e}")))?;
    if url.scheme() != "https" {
        return Err(FrontendUpdateError::Configuration(
            "CODEXTRACE_FRONTEND_URL must use HTTPS".to_string(),
        ));
    }

    let client = build_frontend_http_client(proxy_url)?;

    let mut last_error = String::new();
    for attempt in 0..FRONTEND_DOWNLOAD_ATTEMPTS {
        match client
            .get(url.clone())
            .header(reqwest::header::CACHE_CONTROL, "no-cache")
            .header(reqwest::header::PRAGMA, "no-cache")
            .send()
            .await
        {
            Ok(mut response) if response.status().is_success() => {
                if response
                    .content_length()
                    .is_some_and(|size| size > MAX_FRONTEND_HTML_BYTES as u64)
                {
                    return Err(FrontendUpdateError::Download(format!(
                        "download exceeds the {} byte limit",
                        MAX_FRONTEND_HTML_BYTES
                    )));
                }

                let mut html = Vec::new();
                while let Some(chunk) = response
                    .chunk()
                    .await
                    .map_err(|e| FrontendUpdateError::Download(e.to_string()))?
                {
                    if html.len() + chunk.len() > MAX_FRONTEND_HTML_BYTES {
                        return Err(FrontendUpdateError::Download(format!(
                            "download exceeds the {} byte limit",
                            MAX_FRONTEND_HTML_BYTES
                        )));
                    }
                    html.extend_from_slice(&chunk);
                }
                return Ok(html);
            }
            Ok(response) => {
                let status = response.status();
                last_error = format!("server returned HTTP {status}");
                if !status.is_server_error() && status != reqwest::StatusCode::TOO_MANY_REQUESTS {
                    break;
                }
            }
            Err(error) => last_error = error.to_string(),
        }

        if attempt + 1 < FRONTEND_DOWNLOAD_ATTEMPTS {
            tokio::time::sleep(Duration::from_millis(250 * (attempt + 1) as u64)).await;
        }
    }

    Err(FrontendUpdateError::Download(last_error))
}

async fn install_frontend_html(static_dir: &Path, html: &[u8]) -> Result<(), FrontendUpdateError> {
    tokio::fs::create_dir_all(static_dir)
        .await
        .map_err(|e| FrontendUpdateError::Install(e.to_string()))?;

    let temp_path = static_dir.join(format!(".index.html.{}.tmp", uuid::Uuid::new_v4()));
    let target_path = static_dir.join("index.html");
    if let Err(error) = tokio::fs::write(&temp_path, html).await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(FrontendUpdateError::Install(error.to_string()));
    }
    if let Err(error) = tokio::fs::rename(&temp_path, &target_path).await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(FrontendUpdateError::Install(error.to_string()));
    }

    Ok(())
}

async fn validate_and_install_frontend(
    static_dir: &Path,
    html: &[u8],
) -> Result<(), FrontendUpdateError> {
    validate_frontend_html(html)?;
    install_frontend_html(static_dir, html).await
}

pub(crate) async fn update_frontend_html() -> Result<FrontendUpdateResponse, FrontendUpdateError> {
    let _guard = FRONTEND_UPDATE_LOCK.lock().await;
    let static_dir = resolve_static_dir().ok_or_else(|| {
        FrontendUpdateError::Configuration("CODEXTRACE_STATIC_DIR is not set".to_string())
    })?;
    let frontend_url = std::env::var("CODEXTRACE_FRONTEND_URL")
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            FrontendUpdateError::Configuration("CODEXTRACE_FRONTEND_URL is not set".to_string())
        })?;
    let frontend_proxy = std::env::var("CODEXTRACE_FRONTEND_PROXY")
        .ok()
        .filter(|value| !value.is_empty());

    let html = download_frontend_html(&frontend_url, frontend_proxy.as_deref()).await?;
    validate_and_install_frontend(Path::new(&static_dir), &html).await?;
    Ok(FrontendUpdateResponse {
        updated: true,
        bytes: html.len(),
    })
}

async fn api_update_frontend() -> Response {
    match update_frontend_html().await {
        Ok(result) => ok_json(&result),
        Err(error) => err_response(error.status(), error.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async fn api_get_settings(State(state): State<Arc<HttpState>>) -> Response {
    let app_state = app_state(&state);
    let guard = match app_state.settings.lock() {
        Ok(g) => g,
        Err(e) => {
            return err_response(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        }
    };
    ok_json(&crate::commands::settings::build_settings_response(&guard))
}

#[derive(Deserialize)]
struct SetDirBody {
    path: Option<String>,
}

async fn api_set_sessions_dir(
    State(state): State<Arc<HttpState>>,
    Json(body): Json<SetDirBody>,
) -> Response {
    let app_state = app_state(&state);

    if let Some(ref p) = body.path {
        let pb = std::path::PathBuf::from(p);
        if !pb.exists() {
            return err_response(
                axum::http::StatusCode::BAD_REQUEST,
                format!("path does not exist: {p}"),
            );
        }
        if !pb.is_dir() {
            return err_response(
                axum::http::StatusCode::BAD_REQUEST,
                format!("path is not a directory: {p}"),
            );
        }
    }

    let mut guard = match app_state.settings.lock() {
        Ok(g) => g,
        Err(e) => {
            return err_response(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        }
    };
    guard.sessions_dir = body.path;
    if let Err(e) = crate::settings::save_settings(&guard) {
        return err_response(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    ok_json(&crate::commands::settings::build_settings_response(&guard))
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct DiscoverBody {
    dir: String,
}

async fn api_discover_sessions(
    State(state): State<Arc<HttpState>>,
    Json(body): Json<DiscoverBody>,
) -> Response {
    let app_state = app_state(&state);
    let mut sessions = match app_state.discover_sessions_cached(&body.dir) {
        Ok(s) => s,
        Err(e) => return err_response(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    app_state.apply_watched_ongoing(&mut sessions);
    ok_json(&sessions)
}

#[derive(Deserialize)]
struct PathBody {
    path: String,
    direction: Option<crate::parser::session::SessionPageDirection>,
    cursor: Option<usize>,
    #[serde(rename = "maxBytes")]
    max_bytes: Option<usize>,
    #[serde(rename = "knownSourceSizeBytes")]
    known_source_size_bytes: Option<u64>,
}

async fn api_load_session(
    State(state): State<Arc<HttpState>>,
    Json(body): Json<PathBody>,
) -> Response {
    let state = state.app_state.clone();
    let result = tokio::task::spawn_blocking(move || {
        state.load_session_page(
            &body.path,
            body.direction
                .unwrap_or(crate::parser::session::SessionPageDirection::Backward),
            body.cursor,
            body.max_bytes,
        )
    })
    .await;
    let session = match result {
        Ok(Ok(session)) => session,
        Ok(Err(e)) => return err_response(session_load_error_status(&e), e),
        Err(e) => {
            return err_response(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        }
    };
    ok_json(&session)
}

async fn api_session_status(
    State(state): State<Arc<HttpState>>,
    Json(body): Json<PathBody>,
) -> Response {
    let app_state = state.app_state.clone();
    let result = tokio::task::spawn_blocking(move || {
        app_state.session_status(&body.path, body.known_source_size_bytes)
    })
    .await;
    let status = match result {
        Ok(Ok(status)) => status,
        Ok(Err(e)) => return err_response(session_load_error_status(&e), e),
        Err(e) => {
            return err_response(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        }
    };
    ok_json(&status)
}

// ---------------------------------------------------------------------------
// Watch / unwatch
// ---------------------------------------------------------------------------

async fn api_watch_session(
    State(state): State<Arc<HttpState>>,
    Json(body): Json<PathBody>,
) -> Response {
    let path = body.path;
    let app_state = state.app_state.clone();
    let result = tokio::task::spawn_blocking({
        let app_state = app_state.clone();
        let path = path.clone();
        move || app_state.load_session_snapshot(&path)
    })
    .await;
    let session = match result {
        Ok(Ok(session)) => session,
        Ok(Err(e)) => return err_response(session_load_error_status(&e), e),
        Err(e) => {
            return err_response(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        }
    };
    if let Err(e) = app_state.stop_session_watcher() {
        return err_response(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    app_state.set_watched_ongoing(path.clone(), session.is_ongoing);
    let handle = start_session_watcher(path, app_state.clone(), state.app.clone());
    if let Err(e) = app_state.set_session_watcher(handle) {
        return err_response(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    ok_json(&serde_json::json!({ "ok": true }))
}

async fn api_unwatch_session(State(state): State<Arc<HttpState>>) -> Response {
    let app_state = app_state(&state);
    app_state.clear_watched_ongoing();
    match app_state.stop_session_watcher() {
        Ok(()) => ok_json(&serde_json::json!({ "ok": true })),
        Err(e) => err_response(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

#[derive(Deserialize)]
struct WatchPickerBody {
    #[serde(rename = "sessionsDir")]
    sessions_dir: String,
}

async fn api_watch_picker(
    State(state): State<Arc<HttpState>>,
    Json(body): Json<WatchPickerBody>,
) -> Response {
    let app_state = app_state(&state);
    if let Err(e) = app_state.stop_picker_watcher() {
        return err_response(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    let handle = start_picker_watcher(
        body.sessions_dir,
        state.app_state.clone(),
        state.app.clone(),
    );
    if let Err(e) = app_state.set_picker_watcher(handle) {
        return err_response(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    ok_json(&serde_json::json!({ "ok": true }))
}

async fn api_unwatch_picker(State(state): State<Arc<HttpState>>) -> Response {
    let app_state = app_state(&state);
    match app_state.stop_picker_watcher() {
        Ok(()) => ok_json(&serde_json::json!({ "ok": true })),
        Err(e) => err_response(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// ---------------------------------------------------------------------------
// SSE events
// ---------------------------------------------------------------------------

async fn api_events(
    State(state): State<Arc<HttpState>>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let app_state = app_state(&state);
    let rx = app_state.event_tx.subscribe();

    let stream = BroadcastStream::new(rx).filter_map(|result| {
        result
            .ok()
            .map(|sse_event| Ok(Event::default().event(sse_event.event).data(sse_event.data)))
    });

    Sse::new(stream).keep_alive(KeepAlive::default())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_host_uses_default_when_missing() {
        assert_eq!(pick_host(None), DEFAULT_HTTP_HOST);
    }

    #[test]
    fn pick_host_uses_default_when_empty() {
        assert_eq!(pick_host(Some(String::new())), DEFAULT_HTTP_HOST);
    }

    #[test]
    fn pick_host_uses_provided_value() {
        assert_eq!(pick_host(Some("0.0.0.0".to_string())), "0.0.0.0");
    }

    #[test]
    fn pick_port_uses_default_when_missing() {
        assert_eq!(pick_port(None), DEFAULT_HTTP_PORT);
    }

    #[test]
    fn pick_port_uses_default_when_unparsable() {
        assert_eq!(
            pick_port(Some("not-a-number".to_string())),
            DEFAULT_HTTP_PORT
        );
    }

    #[test]
    fn pick_port_uses_parsed_value() {
        assert_eq!(pick_port(Some("8080".to_string())), 8080);
    }

    #[test]
    fn frontend_validation_accepts_html_case_insensitively() {
        assert!(validate_frontend_html(b"<!DOCTYPE HTML><HTML></HTML>").is_ok());
    }

    #[test]
    fn frontend_validation_rejects_non_html_content() {
        assert!(validate_frontend_html(b"not an html document").is_err());
    }

    #[test]
    fn frontend_client_rejects_invalid_proxy() {
        let result = build_frontend_http_client(Some("://missing-scheme"));
        assert!(matches!(result, Err(FrontendUpdateError::Configuration(_))));
    }

    #[test]
    fn download_filename_is_percent_encoded_for_http_headers() {
        assert_eq!(
            percent_encode_filename("rollout 2026-09-02.jsonl"),
            "rollout%202026-09-02.jsonl"
        );
        assert_eq!(
            percent_encode_filename("会话.jsonl"),
            "%E4%BC%9A%E8%AF%9D.jsonl"
        );
    }

    #[tokio::test]
    async fn session_download_returns_original_file_bytes_and_filename() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rollout test.jsonl");
        let content = br#"{"type":"session_meta"}
"#;
        tokio::fs::write(&path, content).await.unwrap();

        let response = api_download_session(Query(DownloadSessionQuery {
            path: path.to_string_lossy().into_owned(),
        }))
        .await;

        assert_eq!(response.status(), axum::http::StatusCode::OK);
        assert_eq!(
            response.headers()[axum::http::header::CONTENT_TYPE],
            "application/x-ndjson"
        );
        assert_eq!(
            response.headers()[axum::http::header::CONTENT_DISPOSITION],
            "attachment; filename*=UTF-8''rollout%20test.jsonl"
        );
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(body.as_ref(), content);
    }

    #[tokio::test]
    async fn frontend_install_replaces_existing_index() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("index.html");
        tokio::fs::write(&target, b"old frontend").await.unwrap();

        validate_and_install_frontend(dir.path(), b"<!doctype html><html>new frontend</html>")
            .await
            .unwrap();

        assert_eq!(
            tokio::fs::read_to_string(target).await.unwrap(),
            "<!doctype html><html>new frontend</html>"
        );
    }

    #[tokio::test]
    async fn invalid_frontend_does_not_replace_existing_index() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("index.html");
        tokio::fs::write(&target, b"old frontend").await.unwrap();

        assert!(validate_and_install_frontend(dir.path(), b"not html")
            .await
            .is_err());
        assert_eq!(
            tokio::fs::read_to_string(target).await.unwrap(),
            "old frontend"
        );
    }
}
