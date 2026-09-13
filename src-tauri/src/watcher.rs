use std::sync::Arc;
use std::time::Duration;

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::state::AppState;

const WATCHER_DEBOUNCE: Duration = Duration::from_millis(1000);
const ACTIVITY_RECONCILE_INTERVAL: Duration = Duration::from_secs(5);

fn run_debounce_loop(
    rx: std::sync::mpsc::Receiver<Result<notify::Event, notify::Error>>,
    filter: impl Fn(&notify::Event) -> bool,
    signal_tx: mpsc::Sender<()>,
    thread_stop_rx: std::sync::mpsc::Receiver<()>,
) {
    let mut debounce_timer: Option<std::time::Instant> = None;

    loop {
        match thread_stop_rx.try_recv() {
            Ok(()) | Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
            Err(std::sync::mpsc::TryRecvError::Empty) => {}
        }

        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(event)) => {
                if filter(&event) {
                    debounce_timer = Some(std::time::Instant::now());
                }
            }
            Ok(Err(_)) | Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }

        if let Some(timer) = debounce_timer {
            if timer.elapsed() >= WATCHER_DEBOUNCE {
                debounce_timer = None;
                let _ = signal_tx.try_send(());
            }
        }
    }
}

pub struct WatcherHandle {
    stop_tx: mpsc::Sender<()>,
    thread_stop_tx: std::sync::mpsc::SyncSender<()>,
}

impl WatcherHandle {
    pub fn stop(&self) {
        let _ = self.stop_tx.try_send(());
        let _ = self.thread_stop_tx.try_send(());
    }
}

#[derive(Clone, serde::Serialize)]
struct SessionUpdatePayload {
    kind: &'static str,
    session: Option<crate::parser::session::CodexSession>,
    patch: Option<crate::parser::session::SessionPatch>,
}

/// True for `rollout-*.jsonl` and `rollout-*.jsonl.zst` files — Codex's background
/// compression worker replaces a cold plain rollout with a `.jsonl.zst` sibling, so both
/// representations must be treated as session files for change detection.
fn is_rollout_jsonl_name(name: &str) -> bool {
    name.ends_with(".jsonl") || name.ends_with(".jsonl.zst")
}

fn is_related_session_path(changed_path: &Path, session_file: &Path) -> bool {
    if changed_path == session_file {
        return true;
    }

    changed_path
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(is_rollout_jsonl_name)
        && changed_path.parent() == session_file.parent()
}

/// Start watching a session JSONL file for changes.
pub fn start_session_watcher(
    path: String,
    state: Arc<AppState>,
    app: Option<AppHandle>,
) -> WatcherHandle {
    let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);
    let (signal_tx, mut signal_rx) = mpsc::channel::<()>(4);
    let (thread_stop_tx, thread_stop_rx) = std::sync::mpsc::sync_channel::<()>(1);

    let path_clone = path.clone();
    let signal_tx_clone = signal_tx.clone();

    std::thread::spawn(move || {
        let signal_tx = signal_tx_clone;
        let path = path_clone;
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = match RecommendedWatcher::new(tx, Config::default()) {
            Ok(w) => w,
            Err(_) => return,
        };

        // Watch the day directory (parent of file) so we catch appends
        let watch_dir = Path::new(&path).parent().unwrap_or(Path::new(""));
        let _ = watcher.watch(watch_dir, RecursiveMode::NonRecursive);

        let session_file = PathBuf::from(path.clone());
        run_debounce_loop(
            rx,
            move |event| {
                event
                    .paths
                    .iter()
                    .any(|p| is_related_session_path(p, &session_file))
            },
            signal_tx,
            thread_stop_rx,
        );
    });

    let path_for_rebuild = path.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = stop_rx.recv() => break,
                Some(()) = signal_rx.recv() => {
                    let refresh = match tokio::task::spawn_blocking({
                        let state = state.clone();
                        let path = path_for_rebuild.clone();
                        move || state.refresh_session(&path)
                    }).await {
                        Ok(Ok(refresh)) => refresh,
                        Ok(Err(_)) | Err(_) => continue,
                    };

                    let payload = match refresh {
                        crate::parser::session::SessionRefresh::Unchanged => continue,
                        crate::parser::session::SessionRefresh::Full {
                            session,
                            source_size_bytes,
                        } => {
                            let session = crate::parser::session::page_session(
                                session.as_ref(),
                                crate::parser::session::SessionPageDirection::Backward,
                                None,
                                None,
                                source_size_bytes,
                            )
                            .unwrap_or(*session);
                            state.set_watched_ongoing(path_for_rebuild.clone(), session.is_ongoing);
                            SessionUpdatePayload {
                                kind: "full",
                                session: Some(session),
                                patch: None,
                            }
                        }
                        crate::parser::session::SessionRefresh::Patch(patch) => {
                            state.set_watched_ongoing(path_for_rebuild.clone(), patch.is_ongoing);
                            SessionUpdatePayload {
                                kind: "patch",
                                session: None,
                                patch: Some(patch),
                            }
                        }
                    };

                    if let Ok(json) = serde_json::to_string(&payload) {
                        state.broadcast("session-update", &json);
                    }

                    if let Some(ref app_handle) = app {
                        let _ = app_handle.emit("session-update", payload);
                    }
                }
            }
        }
    });

    WatcherHandle {
        stop_tx,
        thread_stop_tx,
    }
}

async fn reconcile_picker_activity(
    sessions_dir: &str,
    state: &Arc<AppState>,
    app: &Option<AppHandle>,
) {
    let result = match tokio::task::spawn_blocking({
        let state = state.clone();
        let sessions_dir = sessions_dir.to_string();
        move || state.reconcile_sessions_dir(&sessions_dir)
    })
    .await
    {
        Ok(Ok(result)) => result,
        Ok(Err(_)) | Err(_) => return,
    };

    let structure_changed = result.structure_changed;
    let picker_metadata_changed = result.picker_metadata_changed;
    for update in result.updates {
        if let Ok(json) = serde_json::to_string(&update) {
            state.broadcast("session-activity", &json);
        }
        if let Some(app_handle) = app {
            let _ = app_handle.emit("session-activity", &update);
        }
    }

    if structure_changed || picker_metadata_changed {
        // A structural change requires a full rescan. Session-index updates are already merged
        // into the cached picker rows by reconciliation, so rename does not reread transcripts.
        if structure_changed {
            state.invalidate_sessions_cache();
        }
        state.broadcast("picker-refresh", "{}");
        if let Some(app_handle) = app {
            let _ = app_handle.emit("picker-refresh", serde_json::json!({}));
        }
    }
}

/// Start watching the sessions directory for new/changed files.
/// Filesystem notifications provide low-latency updates; a five-second metadata-only
/// reconciliation pass repairs missed events without rereading unchanged transcripts.
///
/// `sessions_dir` names the Codex root (possibly overridden by settings); the
/// Claude Code and pi standard locations are watched alongside it so their
/// sessions get the same live-activity treatment.
pub fn start_picker_watcher(
    sessions_dir: String,
    state: Arc<AppState>,
    app: Option<AppHandle>,
) -> WatcherHandle {
    let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);
    let (signal_tx, mut signal_rx) = mpsc::channel::<()>(4);
    let (thread_stop_tx, thread_stop_rx) = std::sync::mpsc::sync_channel::<()>(1);

    let signal_tx_clone = signal_tx.clone();
    let sessions_dir_thread = sessions_dir.clone();
    let sessions_dir_async = sessions_dir.clone();
    let chat_roots: Vec<(crate::parser::provider::Provider, std::path::PathBuf)> =
        state.chat_roots().to_vec();

    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = match RecommendedWatcher::new(tx, Config::default()) {
            Ok(w) => w,
            Err(_) => return,
        };

        for (_, root) in
            crate::parser::provider::session_roots(Some(&sessions_dir_thread), &chat_roots)
        {
            if root.exists() {
                let _ = watcher.watch(&root, RecursiveMode::Recursive);
            }
        }

        run_debounce_loop(
            rx,
            |event| {
                event.paths.iter().any(|p| {
                    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    is_rollout_jsonl_name(name)
                })
            },
            signal_tx_clone,
            thread_stop_rx,
        );
    });

    tokio::spawn(async move {
        let mut reconcile_interval = tokio::time::interval(ACTIVITY_RECONCILE_INTERVAL);
        reconcile_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                _ = stop_rx.recv() => break,
                Some(()) = signal_rx.recv() => {
                    reconcile_picker_activity(&sessions_dir_async, &state, &app).await;
                },
                _ = reconcile_interval.tick() => {
                    reconcile_picker_activity(&sessions_dir_async, &state, &app).await;
                },
            }
        }
    });

    WatcherHandle {
        stop_tx,
        thread_stop_tx,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    #[test]
    fn watcher_handle_stop_idempotent() {
        let (stop_tx, _) = mpsc::channel::<()>(1);
        let (thread_stop_tx, _) = std::sync::mpsc::sync_channel::<()>(1);
        let handle = WatcherHandle {
            stop_tx,
            thread_stop_tx,
        };
        handle.stop();
        handle.stop();
    }

    #[test]
    fn related_session_path_matches_parent_file() {
        let session_file = Path::new("/tmp/sessions/rollout-parent.jsonl");
        assert!(is_related_session_path(session_file, session_file));
    }

    #[test]
    fn related_session_path_matches_sibling_jsonl_worker_file() {
        let session_file = Path::new("/tmp/sessions/rollout-parent.jsonl");
        let worker_file = Path::new("/tmp/sessions/rollout-worker.jsonl");
        assert!(is_related_session_path(worker_file, session_file));
    }

    #[test]
    fn related_session_path_matches_compressed_zst_sibling() {
        // Issue #209: Codex's background compression worker replaces a cold rollout
        // with a `.jsonl.zst` sibling. The watcher must still treat that as related
        // so the picker/session view refreshes instead of going stale.
        let session_file = Path::new("/tmp/sessions/rollout-parent.jsonl");
        let compressed_sibling = Path::new("/tmp/sessions/rollout-parent.jsonl.zst");
        assert!(is_related_session_path(compressed_sibling, session_file));
    }

    #[test]
    fn related_session_path_ignores_non_jsonl_siblings() {
        let session_file = Path::new("/tmp/sessions/rollout-parent.jsonl");
        let temp_file = Path::new("/tmp/sessions/rollout-worker.tmp");
        assert!(!is_related_session_path(temp_file, session_file));
    }

    #[test]
    fn related_session_path_ignores_jsonl_in_other_directory() {
        let session_file = Path::new("/tmp/sessions/rollout-parent.jsonl");
        let other_file = Path::new("/tmp/other/rollout-worker.jsonl");
        assert!(!is_related_session_path(other_file, session_file));
    }

    #[test]
    fn related_session_path_ignores_socket_and_non_jsonl_paths() {
        // Transport boundary guard: the watcher reacts only to .jsonl file
        // events, never to socket or other IPC paths. This confirms codex-trace
        // reads sessions from disk rather than connecting to any live process
        // socket (e.g. the Codex app-server Unix socket upgraded in v0.128.0).
        let session_file = Path::new("/tmp/sessions/rollout-parent.jsonl");
        assert!(!is_related_session_path(
            Path::new("/tmp/sessions/codex.sock"),
            session_file
        ));
        assert!(!is_related_session_path(
            Path::new("/tmp/sessions/codex.pid"),
            session_file
        ));
    }
}
