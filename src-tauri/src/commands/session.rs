use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::parser::session::parse_session;
use crate::parser::session::SessionPageDirection;
use crate::state::AppState;
use crate::watcher::start_session_watcher;

pub const NO_SESSION_PATH_PROVIDED: &str = "no session path provided";

pub fn load_session_from_path(path: &str) -> Result<crate::parser::session::CodexSession, String> {
    if path.is_empty() {
        return Err(NO_SESSION_PATH_PROVIDED.to_string());
    }
    let p = std::path::Path::new(path);
    parse_session(p)
}

#[tauri::command]
pub async fn load_session(
    path: String,
    direction: Option<SessionPageDirection>,
    cursor: Option<usize>,
    max_bytes: Option<usize>,
    state: State<'_, Arc<AppState>>,
) -> Result<crate::parser::session::CodexSession, String> {
    let app_state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        app_state.load_session_page(
            &path,
            direction.unwrap_or(SessionPageDirection::Backward),
            cursor,
            max_bytes,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_session_status(
    path: String,
    known_source_size_bytes: Option<u64>,
    state: State<'_, Arc<AppState>>,
) -> Result<crate::parser::session::SessionStatus, String> {
    let app_state = state.inner().clone();
    tokio::task::spawn_blocking(move || app_state.session_status(&path, known_source_size_bytes))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn watch_session(
    path: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let app_state = state.inner().clone();
    let session = tokio::task::spawn_blocking({
        let path = path.clone();
        move || app_state.load_session_snapshot(&path)
    })
    .await
    .map_err(|error| error.to_string())??;
    state.stop_session_watcher()?;
    state.set_watched_ongoing(path.clone(), session.is_ongoing);
    let handle = start_session_watcher(path, state.inner().clone(), Some(app));
    state.set_session_watcher(handle)
}

#[tauri::command]
pub async fn unwatch_session(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.clear_watched_ongoing();
    state.stop_session_watcher()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_session_from_path_rejects_empty_path() {
        let result = load_session_from_path("");

        assert_eq!(result.unwrap_err(), "no session path provided");
    }
}
