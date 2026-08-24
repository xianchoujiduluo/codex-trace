import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "../lib/invoke";
import type {
  CodexSession,
  SessionPageDirection,
  SessionPatch,
  SessionStatus,
  SessionUpdatePayload,
} from "../../shared/types";
import { useTauriEvent } from "./useTauriEvent";

const SESSION_STATUS_POLL_INTERVAL_MS = 5_000;

interface SessionState {
  session: CodexSession | null;
  loading: boolean;
  loadingMore: boolean;
  sessionPath: string;
}

interface LoadSessionOptions {
  direction?: SessionPageDirection;
  maxBytes?: number;
}

function mergeTurns(
  existing: CodexSession["turns"],
  incoming: CodexSession["turns"],
  direction: SessionPageDirection,
) {
  const values = direction === "backward" ? [...incoming, ...existing] : [...existing, ...incoming];
  const seen = new Set<string>();
  return values.filter((turn) => {
    if (seen.has(turn.turn_id)) return false;
    seen.add(turn.turn_id);
    return true;
  });
}

function applySessionUpdate(session: CodexSession, update: SessionPatch | SessionStatus) {
  const existingTotalTurns = session.pagination?.total_turns ?? session.turns.length;
  const sourceSizeUnchanged =
    !session.pagination || session.pagination.source_size_bytes === update.source_size_bytes;
  const workersUnchanged =
    session.spawned_worker_ids.length === update.spawned_worker_ids.length &&
    session.spawned_worker_ids.every(
      (workerId, index) => workerId === update.spawned_worker_ids[index],
    );
  const tokensUnchanged =
    JSON.stringify(session.total_tokens) === JSON.stringify(update.total_tokens);
  if (
    update.updated_turns.length === 0 &&
    session.is_ongoing === update.is_ongoing &&
    sourceSizeUnchanged &&
    existingTotalTurns === update.total_turns &&
    tokensUnchanged &&
    session.thread_name === update.thread_name &&
    workersUnchanged &&
    session.has_missing_spawn_metadata === update.has_missing_spawn_metadata
  ) {
    return session;
  }

  const existing = new Map(session.turns.map((turn) => [turn.turn_id, turn]));
  for (const turn of update.updated_turns) existing.set(turn.turn_id, turn);
  const turns = [...existing.values()];
  turns.sort((a, b) => (a.started_at ?? 0) - (b.started_at ?? 0));

  return {
    ...session,
    turns,
    is_ongoing: update.is_ongoing,
    total_tokens: update.total_tokens,
    thread_name: update.thread_name,
    spawned_worker_ids: update.spawned_worker_ids,
    has_missing_spawn_metadata: update.has_missing_spawn_metadata,
    pagination: session.pagination
      ? {
          ...session.pagination,
          total_turns: update.total_turns,
          source_size_bytes: update.source_size_bytes,
        }
      : session.pagination,
  };
}

export function useSession() {
  const [state, setState] = useState<SessionState>({
    session: null,
    loading: false,
    loadingMore: false,
    sessionPath: "",
  });
  const requestIdRef = useRef(0);
  const sourceSizeRef = useRef<number | null>(null);

  const loadSession = useCallback(async (path: string, options: LoadSessionOptions = {}) => {
    const requestId = ++requestIdRef.current;
    setState((prev) => ({ ...prev, loading: true }));
    try {
      try {
        await invoke<void>("unwatch_session");
      } catch {
        // ignore
      }
      const session = await invoke<CodexSession>("load_session", {
        path,
        direction: options.direction ?? "backward",
        maxBytes: options.maxBytes,
      });
      if (requestId !== requestIdRef.current) return;
      sourceSizeRef.current = session.pagination?.source_size_bytes ?? null;
      setState({ session, loading: false, loadingMore: false, sessionPath: path });
      try {
        await invoke<void>("watch_session", { path });
      } catch {
        // watcher is optional
      }
    } catch (err) {
      console.error("Failed to load session:", err);
      if (requestId === requestIdRef.current) {
        setState((prev) => ({ ...prev, loading: false }));
      }
    }
  }, []);

  const loadMore = useCallback(async (): Promise<number> => {
    const current = state.session;
    const pagination = current?.pagination;
    if (!current || !pagination?.has_more || pagination.next_cursor === null || state.loadingMore) {
      return 0;
    }

    setState((prev) => ({ ...prev, loadingMore: true }));
    try {
      const page = await invoke<CodexSession>("load_session", {
        path: state.sessionPath,
        direction: pagination.direction,
        cursor: pagination.next_cursor,
        maxBytes: pagination.page_bytes,
      });
      sourceSizeRef.current = page.pagination?.source_size_bytes ?? sourceSizeRef.current;
      const addedCount = page.turns.filter(
        (turn) => !current.turns.some((existing) => existing.turn_id === turn.turn_id),
      ).length;
      setState((prev) => {
        if (!prev.session) return { ...prev, loadingMore: false };
        return {
          ...prev,
          loadingMore: false,
          session: {
            ...prev.session,
            ...page,
            turns: mergeTurns(prev.session.turns, page.turns, pagination.direction),
          },
        };
      });
      return addedCount;
    } catch (err) {
      console.error("Failed to load more session turns:", err);
      setState((prev) => ({ ...prev, loadingMore: false }));
      return 0;
    }
  }, [state.loadingMore, state.session, state.sessionPath]);

  useTauriEvent<SessionUpdatePayload>("session-update", (payload) => {
    if (payload.kind === "full" && payload.session) {
      setState((prev) => {
        if (prev.sessionPath && payload.session?.path !== prev.sessionPath) return prev;
        sourceSizeRef.current =
          payload.session?.pagination?.source_size_bytes ?? sourceSizeRef.current;
        return { ...prev, session: payload.session };
      });
      return;
    }

    const patch = payload.patch;
    if (!patch) return;
    setState((prev) => {
      if (!prev.session || (prev.sessionPath && patch.path !== prev.sessionPath)) return prev;
      sourceSizeRef.current = patch.source_size_bytes;
      return { ...prev, session: applySessionUpdate(prev.session, patch) };
    });
  });

  useEffect(() => {
    if (!state.sessionPath) return;

    const path = state.sessionPath;
    let cancelled = false;
    const reconcileStatus = async () => {
      try {
        const status = await invoke<SessionStatus>("get_session_status", {
          path,
          knownSourceSizeBytes: sourceSizeRef.current,
        });
        if (cancelled || status.path !== path) return;
        sourceSizeRef.current = status.source_size_bytes;
        setState((prev) => {
          if (!prev.session || prev.sessionPath !== status.path) return prev;
          return { ...prev, session: applySessionUpdate(prev.session, status) };
        });
      } catch {
        // The SSE stream and session watcher remain the primary live-update paths. A failed
        // reconciliation is retried on the next interval without interrupting the current view.
      }
    };

    void reconcileStatus();
    const interval = window.setInterval(reconcileStatus, SESSION_STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [state.sessionPath]);

  useEffect(() => {
    return () => {
      invoke<void>("unwatch_session").catch(() => {});
    };
  }, []);

  return {
    ...state,
    loadSession,
    loadMore,
  };
}
