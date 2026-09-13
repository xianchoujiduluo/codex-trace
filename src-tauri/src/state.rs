use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tokio::sync::broadcast;

use crate::parser::activity::ActivityTracker;
use crate::parser::discover::CodexSessionInfo;
use crate::parser::provider;
use crate::parser::session::{
    page_session, CodexSession, SessionHandle, SessionPageDirection, SessionRefresh, SessionStatus,
};
use crate::settings::Settings;
use crate::watcher::WatcherHandle;

/// A Server-Sent Event destined for browser clients.
#[derive(Clone, Debug)]
pub struct SseEvent {
    pub event: String,
    pub data: String,
}

struct SessionsCache {
    dir: String,
    cached_at: Instant,
    sessions: Vec<CodexSessionInfo>,
}

const SESSIONS_CACHE_TTL: Duration = Duration::from_secs(2);
const MAX_PARSED_SESSION_CACHE_ENTRIES: usize = 8;
const MAX_PARSED_SESSION_CACHE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Debug, serde::Serialize)]
pub struct SessionActivityUpdate {
    pub path: String,
    pub is_ongoing: bool,
    pub last_activity_time: String,
    pub file_size_bytes: u64,
    pub last_user_message: Option<String>,
}

#[derive(Default)]
pub struct ActivityReconciliation {
    pub updates: Vec<SessionActivityUpdate>,
    pub structure_changed: bool,
    pub picker_metadata_changed: bool,
}

type SessionIndexFingerprint = Option<(u64, Option<SystemTime>)>;

pub struct AppState {
    pub session_watcher: Mutex<Option<WatcherHandle>>,
    pub picker_watcher: Mutex<Option<WatcherHandle>>,
    pub settings: Mutex<Settings>,
    pub watched_session_ongoing: Mutex<Option<(String, bool)>>,
    pub event_tx: broadcast::Sender<SseEvent>,
    /// Chat-provider log roots (Claude Code, pi) scanned alongside the Codex
    /// sessions dir. Injectable so tests can isolate discovery from the
    /// machine's real agent homes.
    chat_roots: Vec<(provider::Provider, std::path::PathBuf)>,
    sessions_cache: Mutex<Option<SessionsCache>>,
    parsed_sessions: Mutex<HashMap<String, Arc<Mutex<SessionHandle>>>>,
    activity_trackers: Mutex<HashMap<String, ActivityTracker>>,
    session_index_fingerprints: Mutex<HashMap<String, SessionIndexFingerprint>>,
}

impl AppState {
    pub fn new() -> Self {
        Self::with_chat_roots(provider::default_chat_roots())
    }

    pub fn with_chat_roots(chat_roots: Vec<(provider::Provider, std::path::PathBuf)>) -> Self {
        let (event_tx, _) = broadcast::channel(64);
        Self {
            session_watcher: Mutex::new(None),
            picker_watcher: Mutex::new(None),
            settings: Mutex::new(crate::settings::load_settings()),
            watched_session_ongoing: Mutex::new(None),
            event_tx,
            chat_roots,
            sessions_cache: Mutex::new(None),
            parsed_sessions: Mutex::new(HashMap::new()),
            activity_trackers: Mutex::new(HashMap::new()),
            session_index_fingerprints: Mutex::new(HashMap::new()),
        }
    }

    /// The chat roots this state scans, exposed for the picker watcher.
    pub fn chat_roots(&self) -> &[(provider::Provider, std::path::PathBuf)] {
        &self.chat_roots
    }

    fn parsed_session(&self, path: &str) -> Result<Arc<Mutex<SessionHandle>>, String> {
        if path.is_empty() {
            return Err(crate::commands::session::NO_SESSION_PATH_PROVIDED.to_string());
        }

        {
            let cache = self.parsed_sessions.lock().map_err(|e| e.to_string())?;
            if let Some(entry) = cache.get(path) {
                return Ok(entry.clone());
            }
        }

        let parsed = Arc::new(Mutex::new(SessionHandle::load(std::path::Path::new(path))?));
        let mut cache = self.parsed_sessions.lock().map_err(|e| e.to_string())?;
        if let Some(entry) = cache.get(path) {
            return Ok(entry.clone());
        }
        let parsed_size = parsed
            .lock()
            .map(|session| session.source_size_bytes())
            .unwrap_or(0);
        let mut cached_size: u64 = cache
            .values()
            .filter_map(|entry| entry.lock().ok().map(|session| session.source_size_bytes()))
            .sum();
        while (cache.len() >= MAX_PARSED_SESSION_CACHE_ENTRIES
            || cached_size.saturating_add(parsed_size) > MAX_PARSED_SESSION_CACHE_BYTES)
            && !cache.is_empty()
        {
            if let Some(oldest_key) = cache.keys().next().cloned() {
                if let Some(oldest) = cache.remove(&oldest_key) {
                    cached_size = cached_size.saturating_sub(
                        oldest
                            .lock()
                            .map(|session| session.source_size_bytes())
                            .unwrap_or(0),
                    );
                }
            } else {
                break;
            }
        }
        cache.insert(path.to_string(), parsed.clone());
        Ok(parsed)
    }

    /// Load a session from the shared parsed-session cache and return the requested page.
    pub fn load_session_page(
        &self,
        path: &str,
        direction: SessionPageDirection,
        cursor: Option<usize>,
        max_bytes: Option<usize>,
    ) -> Result<CodexSession, String> {
        let entry = self.parsed_session(path)?;
        let mut session = entry.lock().map_err(|e| e.to_string())?;
        let _ = session.refresh()?;
        page_session(
            session.session(),
            direction,
            cursor,
            max_bytes,
            session.source_size_bytes(),
        )
    }

    /// Return the current complete snapshot for watcher setup and Tauri callers.
    pub fn load_session_snapshot(&self, path: &str) -> Result<CodexSession, String> {
        let entry = self.parsed_session(path)?;
        let mut session = entry.lock().map_err(|e| e.to_string())?;
        let _ = session.refresh()?;
        Ok(session.session().clone())
    }

    /// Refresh the cached parser and return only the activity and changed-turn fields needed to
    /// reconcile a live UI after an SSE reconnect or a missed filesystem notification.
    pub fn session_status(
        &self,
        path: &str,
        known_source_size_bytes: Option<u64>,
    ) -> Result<SessionStatus, String> {
        let entry = self.parsed_session(path)?;
        let mut session = entry.lock().map_err(|e| e.to_string())?;
        session.status_reconciliation(known_source_size_bytes)
    }

    /// Refresh a cached parser and return only the changed data for the live watcher.
    pub fn refresh_session(&self, path: &str) -> Result<SessionRefresh, String> {
        let entry = self.parsed_session(path)?;
        let mut session = entry.lock().map_err(|e| e.to_string())?;
        session.refresh()
    }

    pub fn stop_session_watcher(&self) -> Result<(), String> {
        let mut guard = self.session_watcher.lock().map_err(|e| e.to_string())?;
        if let Some(handle) = guard.take() {
            handle.stop();
        }
        Ok(())
    }

    pub fn set_session_watcher(&self, handle: WatcherHandle) -> Result<(), String> {
        let mut guard = self.session_watcher.lock().map_err(|e| e.to_string())?;
        *guard = Some(handle);
        Ok(())
    }

    pub fn stop_picker_watcher(&self) -> Result<(), String> {
        let mut guard = self.picker_watcher.lock().map_err(|e| e.to_string())?;
        if let Some(handle) = guard.take() {
            handle.stop();
        }
        Ok(())
    }

    pub fn set_picker_watcher(&self, handle: WatcherHandle) -> Result<(), String> {
        let mut guard = self.picker_watcher.lock().map_err(|e| e.to_string())?;
        *guard = Some(handle);
        Ok(())
    }

    pub fn set_watched_ongoing(&self, path: String, ongoing: bool) {
        if let Ok(mut trackers) = self.activity_trackers.lock() {
            if let Some(tracker) = trackers.get_mut(&path) {
                tracker.set_ongoing(ongoing);
                return;
            }
        }
        if let Ok(mut guard) = self.watched_session_ongoing.lock() {
            *guard = Some((path, ongoing));
        }
    }

    pub fn clear_watched_ongoing(&self) {
        if let Ok(mut guard) = self.watched_session_ongoing.lock() {
            *guard = None;
        }
    }

    pub fn apply_watched_ongoing(&self, sessions: &mut [CodexSessionInfo]) {
        let fallback = self
            .watched_session_ongoing
            .lock()
            .ok()
            .and_then(|guard| (*guard).clone());
        if let Ok(trackers) = self.activity_trackers.lock() {
            for session in sessions.iter_mut() {
                if let Some(tracker) = trackers.get(&session.path) {
                    let snapshot = tracker.snapshot();
                    session.is_ongoing = snapshot.is_ongoing;
                    session.last_activity_time = snapshot.last_activity_time;
                    session.file_size_bytes = snapshot.file_size_bytes;
                } else if let Some((ref path, ongoing)) = fallback {
                    if session.path == *path {
                        session.is_ongoing = ongoing;
                    }
                }
            }
        }
    }

    /// Seed the activity trackers from the initial full picker scan. The tracker stores only
    /// event state and the current byte offset; it does not retain the transcript contents.
    pub fn seed_session_activity(&self, sessions: &[CodexSessionInfo]) {
        let Ok(mut trackers) = self.activity_trackers.lock() else {
            return;
        };
        for session in sessions {
            trackers.insert(session.path.clone(), ActivityTracker::from_info(session));
        }
    }

    /// Reconcile all session paths using metadata and incrementally refresh only changed files.
    /// A new or removed path marks the structure as changed so the frontend can perform one
    /// normal picker refresh; ordinary appends are delivered as per-session activity updates.
    pub fn reconcile_sessions_dir(
        &self,
        sessions_dir: &str,
    ) -> Result<ActivityReconciliation, String> {
        // Reconcile every provider root: the codex sessions dir (possibly
        // overridden) plus the configured chat roots (Claude Code, pi).
        let paths = provider::collect_all_session_paths(Some(sessions_dir), &self.chat_roots);
        let roots = provider::session_roots(Some(sessions_dir), &self.chat_roots);
        let under_any_root =
            |path: &std::path::Path| roots.iter().any(|(_, root)| path.starts_with(root));
        let mut trackers = self.activity_trackers.lock().map_err(|e| e.to_string())?;
        let mut result = ActivityReconciliation::default();

        let index_fingerprint = session_index_fingerprint(sessions_dir);
        if let Ok(mut fingerprints) = self.session_index_fingerprints.lock() {
            match fingerprints.get(sessions_dir) {
                Some(previous) if previous != &index_fingerprint => {
                    result.picker_metadata_changed = true;
                    fingerprints.insert(sessions_dir.to_string(), index_fingerprint);
                }
                None => {
                    fingerprints.insert(sessions_dir.to_string(), index_fingerprint);
                }
                _ => {}
            }
        }

        for path in &paths {
            let key = path.to_string_lossy().to_string();
            let before = trackers.get(&key).map(|tracker| tracker.snapshot());

            let snapshot = if let Some(tracker) = trackers.get_mut(&key) {
                match tracker.refresh() {
                    Ok(snapshot) => snapshot,
                    Err(_) => continue,
                }
            } else {
                result.structure_changed = true;
                let Ok(tracker) = ActivityTracker::load(path) else {
                    continue;
                };
                let snapshot = tracker.snapshot();
                trackers.insert(key.clone(), tracker);
                snapshot
            };

            if before.as_ref() != Some(&snapshot) {
                result.updates.push(SessionActivityUpdate {
                    path: key,
                    is_ongoing: snapshot.is_ongoing,
                    last_activity_time: snapshot.last_activity_time,
                    file_size_bytes: snapshot.file_size_bytes,
                    last_user_message: snapshot.last_user_message,
                });
            }
        }

        let removed: Vec<String> = trackers
            .iter()
            .filter(|(_, tracker)| {
                under_any_root(tracker.path()) && !paths.contains(tracker.path())
            })
            .map(|(path, _)| path.clone())
            .collect();
        if !removed.is_empty() {
            result.structure_changed = true;
            for path in removed {
                trackers.remove(&path);
            }
        }

        // Keep the short-lived picker cache consistent with incremental activity updates. A
        // structural change is invalidated by the watcher after this method returns.
        drop(trackers);
        if !result.structure_changed
            && (!result.updates.is_empty() || result.picker_metadata_changed)
        {
            if let Ok(mut cache) = self.sessions_cache.lock() {
                if let Some(cache) = cache.as_mut() {
                    if cache.dir == sessions_dir {
                        for update in &result.updates {
                            if let Some(session) =
                                cache.sessions.iter_mut().find(|s| s.path == update.path)
                            {
                                session.is_ongoing = update.is_ongoing;
                                session.last_activity_time = update.last_activity_time.clone();
                                session.file_size_bytes = update.file_size_bytes;
                                session.last_user_message = update.last_user_message.clone();
                            }
                        }
                        if result.picker_metadata_changed {
                            crate::parser::discover::apply_session_index(
                                std::path::Path::new(sessions_dir),
                                &mut cache.sessions,
                            );
                            cache.cached_at = Instant::now();
                        }
                    }
                }
            }
        }

        Ok(result)
    }

    pub fn invalidate_sessions_cache(&self) {
        if let Ok(mut cache) = self.sessions_cache.lock() {
            *cache = None;
        }
    }

    /// Discover sessions for `dir`, returning a cached result if fresh enough.
    /// Multiple concurrent callers within the TTL window share one disk scan.
    ///
    /// `dir` overrides the Codex sessions root; chat-provider (Claude Code, pi)
    /// sessions are merged in from the configured chat roots.
    pub fn discover_sessions_cached(&self, dir: &str) -> Result<Vec<CodexSessionInfo>, String> {
        let mut cache = self.sessions_cache.lock().map_err(|e| e.to_string())?;
        if let Some(ref c) = *cache {
            if c.dir == dir && c.cached_at.elapsed() < SESSIONS_CACHE_TTL {
                return Ok(c.sessions.clone());
            }
        }
        let sessions = provider::discover_all(Some(dir), &self.chat_roots);
        self.seed_session_activity(&sessions);
        if let Ok(mut fingerprints) = self.session_index_fingerprints.lock() {
            fingerprints.insert(dir.to_string(), session_index_fingerprint(dir));
        }
        *cache = Some(SessionsCache {
            dir: dir.to_string(),
            cached_at: Instant::now(),
            sessions: sessions.clone(),
        });
        Ok(sessions)
    }

    pub fn broadcast(&self, event: &str, data: &str) {
        let _ = self.event_tx.send(SseEvent {
            event: event.to_string(),
            data: data.to_string(),
        });
    }
}

fn session_index_fingerprint(sessions_dir: &str) -> SessionIndexFingerprint {
    let path = std::path::Path::new(sessions_dir)
        .parent()?
        .join("session_index.jsonl");
    let metadata = std::fs::metadata(path).ok()?;
    Some((metadata.len(), metadata.modified().ok()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_state() -> AppState {
        // No chat roots: keeps discovery scoped to the codex dir under test,
        // independent of the real ~/.claude / ~/.pi on this machine.
        AppState::with_chat_roots(Vec::new())
    }

    #[test]
    fn discover_sessions_cached_returns_empty_for_nonexistent_dir() {
        // discover_sessions returns Ok(empty) for nonexistent dirs (not an error).
        let state = make_state();
        let result = state.discover_sessions_cached("/nonexistent/path/that/does/not/exist");
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn discover_sessions_cached_hits_cache_on_second_call() {
        let state = make_state();
        // Use a real empty temp dir so the first call succeeds and populates cache
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap();

        let first = state.discover_sessions_cached(path).unwrap();
        assert!(first.is_empty());

        // Prime the cache with a fake entry by directly writing to the cache lock
        {
            let mut cache = state.sessions_cache.lock().unwrap();
            *cache = Some(SessionsCache {
                dir: path.to_string(),
                cached_at: Instant::now(),
                sessions: vec![CodexSessionInfo {
                    id: "cached-session".to_string(),
                    path: "/fake/path.jsonl".to_string(),
                    cwd: None,
                    provider: "codex".to_string(),
                    git_branch: None,
                    originator: None,
                    model: None,
                    cli_version: None,
                    thread_name: None,
                    last_user_message: None,
                    turn_count: 0,
                    start_time: String::new(),
                    end_time: None,
                    total_tokens: None,
                    is_ongoing: false,
                    is_external_worker: false,
                    is_inline_worker: false,
                    is_headless: false,
                    is_archived: false,
                    worker_nickname: None,
                    worker_role: None,
                    spawned_worker_ids: vec![],
                    date_group: String::new(),
                    ai_title: None,
                    approval_mode: None,
                    history_base_thread_id: None,
                    last_activity_time: String::new(),
                    file_size_bytes: 0,
                    has_session_end: false,
                }],
            });
        }

        // Second call must return the cached fake entry, not re-scan the dir
        let second = state.discover_sessions_cached(path).unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].id, "cached-session");
    }

    #[test]
    fn discover_sessions_cached_invalidates_cache_for_different_dir() {
        let state = make_state();
        let dir_a = tempfile::tempdir().unwrap();
        let dir_b = tempfile::tempdir().unwrap();

        // Populate cache for dir_a with a fake entry
        {
            let mut cache = state.sessions_cache.lock().unwrap();
            *cache = Some(SessionsCache {
                dir: dir_a.path().to_str().unwrap().to_string(),
                cached_at: Instant::now(),
                sessions: vec![CodexSessionInfo {
                    id: "dir-a-session".to_string(),
                    path: "/fake/a.jsonl".to_string(),
                    cwd: None,
                    provider: "codex".to_string(),
                    git_branch: None,
                    originator: None,
                    model: None,
                    cli_version: None,
                    thread_name: None,
                    last_user_message: None,
                    turn_count: 0,
                    start_time: String::new(),
                    end_time: None,
                    total_tokens: None,
                    is_ongoing: false,
                    is_external_worker: false,
                    is_inline_worker: false,
                    is_headless: false,
                    is_archived: false,
                    worker_nickname: None,
                    worker_role: None,
                    spawned_worker_ids: vec![],
                    date_group: String::new(),
                    ai_title: None,
                    approval_mode: None,
                    history_base_thread_id: None,
                    last_activity_time: String::new(),
                    file_size_bytes: 0,
                    has_session_end: false,
                }],
            });
        }

        // Requesting dir_b must bypass the cache and return the real (empty) scan
        let result = state
            .discover_sessions_cached(dir_b.path().to_str().unwrap())
            .unwrap();
        assert!(
            result.is_empty(),
            "different dir must not return dir_a cached data"
        );
    }

    #[test]
    fn activity_reconciliation_updates_only_the_changed_session() {
        let dir = tempfile::tempdir().unwrap();
        let active_path = dir.path().join("rollout-active.jsonl");
        let completed_path = dir.path().join("rollout-completed.jsonl");
        let active_content = concat!(
            r#"{"timestamp":"2026-08-18T12:00:00Z","type":"session_meta","payload":{"id":"active"}}"#,
            "\n",
            r#"{"timestamp":"2026-08-18T12:00:01Z","type":"event_msg","payload":{"type":"task_started"}}"#,
            "\n",
        );
        std::fs::write(&active_path, active_content).unwrap();
        std::fs::write(
            &completed_path,
            concat!(
                r#"{"timestamp":"2026-08-18T12:00:00Z","type":"session_meta","payload":{"id":"completed"}}"#,
                "\n",
                r#"{"timestamp":"2026-08-18T12:00:01Z","type":"event_msg","payload":{"type":"task_started"}}"#,
                "\n",
                r#"{"timestamp":"2026-08-18T12:00:02Z","type":"event_msg","payload":{"type":"task_complete"}}"#,
                "\n",
            ),
        )
        .unwrap();

        let state = make_state();
        let initial = state
            .discover_sessions_cached(dir.path().to_str().unwrap())
            .unwrap();
        assert_eq!(initial.len(), 2);
        assert!(initial.iter().any(|session| session.is_ongoing));
        assert!(initial.iter().any(|session| !session.is_ongoing));

        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&active_path)
            .unwrap();
        writeln!(
            file,
            r#"{{"timestamp":"2026-08-18T12:00:02Z","type":"event_msg","payload":{{"type":"task_complete"}}}}"#
        )
        .unwrap();

        let result = state
            .reconcile_sessions_dir(dir.path().to_str().unwrap())
            .unwrap();
        assert!(!result.structure_changed);
        assert_eq!(result.updates.len(), 1);
        assert_eq!(result.updates[0].path, active_path.to_string_lossy());
        assert!(!result.updates[0].is_ongoing);
        assert_eq!(result.updates[0].last_activity_time, "2026-08-18T12:00:02Z");

        let refreshed = state
            .discover_sessions_cached(dir.path().to_str().unwrap())
            .unwrap();
        assert!(refreshed.iter().all(|session| !session.is_ongoing));
        assert_eq!(
            refreshed
                .iter()
                .find(|session| session.id == "active")
                .map(|session| session.last_activity_time.as_str()),
            Some("2026-08-18T12:00:02Z")
        );
    }

    #[test]
    fn session_status_refreshes_a_missed_terminal_event() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rollout-status.jsonl");
        std::fs::write(
            &path,
            concat!(
                r#"{"timestamp":"2026-08-18T12:00:00Z","type":"session_meta","payload":{"id":"status"}}"#,
                "\n",
                r#"{"timestamp":"2026-08-18T12:00:01Z","type":"event_msg","payload":{"type":"task_started"}}"#,
                "\n",
            ),
        )
        .unwrap();

        let state = make_state();
        let active = state.session_status(path.to_str().unwrap(), None).unwrap();
        assert!(active.is_ongoing);

        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        writeln!(
            file,
            r#"{{"timestamp":"2026-08-18T12:00:02Z","type":"event_msg","payload":{{"type":"task_complete"}}}}"#
        )
        .unwrap();

        let completed = state
            .session_status(path.to_str().unwrap(), Some(active.source_size_bytes))
            .unwrap();
        assert!(!completed.is_ongoing);
        assert!(completed.source_size_bytes > active.source_size_bytes);
        assert_eq!(completed.updated_turns.len(), 1);
        assert_eq!(
            completed.updated_turns[0].status,
            crate::parser::turn::TurnStatus::Complete
        );

        let unchanged = state
            .session_status(path.to_str().unwrap(), Some(completed.source_size_bytes))
            .unwrap();
        assert!(unchanged.updated_turns.is_empty());

        let without_cursor = state.session_status(path.to_str().unwrap(), None).unwrap();
        assert!(without_cursor.updated_turns.is_empty());
    }

    #[test]
    fn reconciliation_merges_an_appended_session_index_name_without_rescanning_rollouts() {
        let dir = tempfile::tempdir().unwrap();
        let sessions_dir = dir.path().join("sessions");
        let day_dir = sessions_dir.join("2026/08/20");
        std::fs::create_dir_all(&day_dir).unwrap();
        std::fs::write(
            day_dir.join("rollout-rename.jsonl"),
            r#"{"timestamp":"2026-08-20T10:00:00Z","type":"session_meta","payload":{"id":"rename-session","timestamp":"2026-08-20T10:00:00Z"}}"#,
        )
        .unwrap();
        let index_path = dir.path().join("session_index.jsonl");
        std::fs::write(
            &index_path,
            r#"{"id":"rename-session","thread_name":"First name","updated_at":"2026-08-20T10:01:00Z"}
"#,
        )
        .unwrap();

        let state = make_state();
        let sessions_dir_str = sessions_dir.to_str().unwrap();
        let initial = state.discover_sessions_cached(sessions_dir_str).unwrap();
        assert_eq!(initial[0].thread_name.as_deref(), Some("First name"));

        let mut index = std::fs::OpenOptions::new()
            .append(true)
            .open(index_path)
            .unwrap();
        writeln!(
            index,
            r#"{{"id":"rename-session","thread_name":"Latest name","updated_at":"2026-08-20T10:02:00Z"}}"#
        )
        .unwrap();

        let reconciliation = state.reconcile_sessions_dir(sessions_dir_str).unwrap();
        assert!(reconciliation.picker_metadata_changed);
        assert!(!reconciliation.structure_changed);

        let refreshed = state.discover_sessions_cached(sessions_dir_str).unwrap();
        assert_eq!(refreshed[0].thread_name.as_deref(), Some("Latest name"));
    }
}
