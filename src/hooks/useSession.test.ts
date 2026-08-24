import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexSession, SessionStatus } from "../../shared/types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("../lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("./useTauriEvent", () => ({ useTauriEvent: vi.fn() }));

import { useSession } from "./useSession";

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
