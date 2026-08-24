import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "../lib/invoke";
import type {
  CodexSession,
  SessionPageDirection,
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

export function useSession() {
  const [state, setState] = useState<SessionState>({
    session: null,
    loading: false,
    loadingMore: false,
    sessionPath: "",
  });
  const requestIdRef = useRef(0);

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
        return { ...prev, session: payload.session };
      });
      return;
    }

    const patch = payload.patch;
    if (!patch) return;
    setState((prev) => {
      if (!prev.session || (prev.sessionPath && patch.path !== prev.sessionPath)) return prev;
      const existing = new Map(prev.session.turns.map((turn) => [turn.turn_id, turn]));
      for (const turn of patch.updated_turns) existing.set(turn.turn_id, turn);
      const turns = [...existing.values()];
      turns.sort((a, b) => (a.started_at ?? 0) - (b.started_at ?? 0));
      return {
        ...prev,
        session: {
          ...prev.session,
          turns,
          is_ongoing: patch.is_ongoing,
          total_tokens: patch.total_tokens,
          thread_name: patch.thread_name,
          spawned_worker_ids: patch.spawned_worker_ids,
          has_missing_spawn_metadata: patch.has_missing_spawn_metadata,
          pagination: prev.session.pagination
            ? {
                ...prev.session.pagination,
                total_turns: patch.total_turns,
                source_size_bytes: patch.source_size_bytes,
              }
            : prev.session.pagination,
        },
      };
    });
  });

  useEffect(() => {
    if (!state.sessionPath) return;

    let cancelled = false;
    const reconcileStatus = async () => {
      try {
        const status = await invoke<SessionStatus>("get_session_status", {
          path: state.sessionPath,
        });
        if (cancelled) return;
        setState((prev) => {
          if (!prev.session || prev.sessionPath !== status.path) return prev;
          const pagination = prev.session.pagination
            ? {
                ...prev.session.pagination,
                source_size_bytes: status.source_size_bytes,
              }
            : prev.session.pagination;
          if (
            prev.session.is_ongoing === status.is_ongoing &&
            prev.session.pagination?.source_size_bytes === status.source_size_bytes
          ) {
            return prev;
          }
          return {
            ...prev,
            session: {
              ...prev.session,
              is_ongoing: status.is_ongoing,
              pagination,
            },
          };
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
