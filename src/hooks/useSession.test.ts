import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexSession, CodexTurn, SessionStatus } from "../../shared/types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  tauriEvent: vi.fn(),
}));

vi.mock("../lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("./useTauriEvent", () => ({ useTauriEvent: mocks.tauriEvent }));

import { useSession } from "./useSession";

function makeTurn(turnId: string, startedAt: number): CodexTurn {
  return {
    turn_id: turnId,
    started_at: startedAt,
    completed_at: startedAt + 10,
    duration_ms: 10_000,
    status: "complete",
    user_message: `prompt for ${turnId}`,
    agent_messages: [],
    tool_calls: [],
    final_answer: null,
    total_tokens: null,
    model: null,
    cwd: null,
    reasoning_effort: null,
    error: null,
    has_compaction: false,
    thread_name: null,
    collab_spawns: [],
    trace_id: null,
    forked_from_thread_id: null,
    compaction_meta: null,
  };
}

function makeSession(path: string): CodexSession {
  return {
    id: "session-1",
    timestamp: "2026-08-24T10:00:00Z",
    cwd: "/workspace/project",
    originator: null,
    cli_version: null,
    model_provider: "openai",
    git: null,
    instructions: null,
    turns: [],
    is_ongoing: true,
    total_tokens: null,
    thread_name: null,
    spawned_worker_ids: [],
    ai_title: null,
    path,
    is_headless: false,
    has_missing_spawn_metadata: false,
    is_archived: false,
    approval_mode: null,
    history_base_thread_id: null,
    pagination: null,
  };
}

describe("useSession status reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("corrects a missed terminal SSE update from the status endpoint", async () => {
    const path = "/sessions/2026/08/24/rollout-session.jsonl";
    const session = makeSession(path);
    const status: SessionStatus = {
      path,
      is_ongoing: false,
      source_size_bytes: 128,
      updated_turns: [],
      total_turns: 0,
      total_tokens: null,
      thread_name: null,
      spawned_worker_ids: [],
      has_missing_spawn_metadata: false,
    };
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "load_session") return session;
      if (command === "get_session_status") return status;
      return undefined;
    });

    const { result } = renderHook(() => useSession());
    await act(async () => {
      await result.current.loadSession(path);
    });

    await waitFor(() => expect(result.current.session?.is_ongoing).toBe(false));
    expect(mocks.invoke).toHaveBeenCalledWith("get_session_status", {
      path,
      knownSourceSizeBytes: null,
    });
  });
});

describe("useSession full-refresh merging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps turns already paged in when the watcher rebuilds the session", async () => {
    // The watcher broadcasts only the newest page of a rebuilt session, so a
    // wholesale replace dropped every older turn the reader had loaded.
    const path = "/sessions/2026/08/24/rollout-session.jsonl";
    const older = makeTurn("turn-old", 100);
    const newest = makeTurn("turn-new", 200);
    const loaded: CodexSession = {
      ...makeSession(path),
      turns: [older, newest],
      pagination: {
        direction: "backward",
        next_cursor: 1,
        has_more: true,
        total_turns: 9,
        source_size_bytes: 20_000_000,
        page_bytes: 10_000_000,
      },
    };
    const rebuilt: CodexSession = {
      ...makeSession(path),
      turns: [newest],
      pagination: {
        direction: "backward",
        next_cursor: null,
        has_more: false,
        total_turns: 9,
        source_size_bytes: 20_000_100,
        page_bytes: 10_000_000,
      },
    };

    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "load_session") return loaded;
      return undefined;
    });
    // Capture the subscription instead of firing it during render: setState
    // from a render-phase handler would loop forever.
    let onUpdate: ((payload: unknown) => void) | undefined;
    mocks.tauriEvent.mockImplementation((_name: string, handler: (payload: unknown) => void) => {
      onUpdate = handler;
    });

    const { result } = renderHook(() => useSession());
    await act(async () => {
      await result.current.loadSession(path);
    });

    const session = result.current.session!;
    expect(session.turns.map((turn) => turn.turn_id)).toEqual(["turn-old", "turn-new"]);

    await act(async () => {
      onUpdate!({ kind: "full", session: rebuilt, patch: null });
    });

    const merged = result.current.session!;
    expect(merged.turns.map((turn) => turn.turn_id)).toEqual(["turn-old", "turn-new"]);
    // The older edge the reader reached is what "load older turns" continues from.
    expect(merged.pagination?.next_cursor).toBe(1);
    expect(merged.pagination?.has_more).toBe(true);
    // Counts still follow the file.
    expect(merged.pagination?.source_size_bytes).toBe(20_000_100);
  });
});
