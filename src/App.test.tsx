import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage, CodexSession, CodexSessionInfo, CodexTurn } from "../shared/types";

const mocks = vi.hoisted(() => ({
  loadSession: vi.fn(),
  loadMore: vi.fn().mockResolvedValue(0),
  discoverSessions: vi.fn(),
  updateSessionOngoing: vi.fn(),
  setSearchQuery: vi.fn(),
  setSessionFilter: vi.fn(),
  sessions: [] as CodexSessionInfo[],
  session: null as CodexSession | null,
  sessionPath: "",
}));

vi.mock("./hooks/useSession", () => ({
  useSession: () => ({
    session: mocks.session,
    loading: false,
    loadingMore: false,
    sessionPath: mocks.sessionPath,
    loadSession: mocks.loadSession,
    loadMore: mocks.loadMore,
  }),
}));

vi.mock("./hooks/usePicker", () => ({
  resolveSessionsDir: vi.fn().mockResolvedValue(""),
  usePicker: () => ({
    sessions: mocks.sessions,
    allSessions: mocks.sessions,
    loading: false,
    searchQuery: "",
    sessionsDir: "/sessions",
    sessionFilter: "all",
    setSearchQuery: mocks.setSearchQuery,
    setSessionFilter: mocks.setSessionFilter,
    discoverSessions: mocks.discoverSessions,
    updateSessionOngoing: mocks.updateSessionOngoing,
  }),
}));

import { App } from "./App";

function makeSession(): CodexSessionInfo {
  return {
    id: "01900000-0000-7000-8000-000000000001",
    path: "/sessions/2026/08/20/rollout-session.jsonl",
    cwd: "/workspace/project",
    git_branch: "main",
    originator: null,
    model: "gpt-5",
    cli_version: null,
    thread_name: "Batch copy session",
    last_user_message: "Copy this session",
    turn_count: 1,
    start_time: "2026-08-20T10:00:00Z",
    end_time: "2026-08-20T10:01:00Z",
    total_tokens: 100,
    is_ongoing: false,
    is_external_worker: false,
    is_inline_worker: false,
    worker_nickname: null,
    worker_role: null,
    spawned_worker_ids: [],
    date_group: "2026/08/20",
    ai_title: null,
    is_headless: false,
    is_archived: false,
    approval_mode: null,
    history_base_thread_id: null,
    last_activity_time: "2026-08-20T10:01:00Z",
    file_size_bytes: 1024,
  };
}

describe("App session ID batch copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessions.splice(0);
    mocks.session = null;
    mocks.sessionPath = "";
  });

  it("copies selected IDs, exits selection mode, and confirms success", async () => {
    const session = makeSession();
    mocks.sessions.splice(0, mocks.sessions.length, session);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Select session IDs to copy" }));
    const checkbox = screen.getByRole("checkbox", { name: `Select session ${session.id}` });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Copy 1 selected session ID" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(session.id));
    expect(screen.queryByRole("checkbox", { name: `Select session ${session.id}` })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Copied 1 session ID");
    expect(mocks.loadSession).not.toHaveBeenCalled();
  });

  it("focuses session search when slash is pressed", async () => {
    render(<App />);

    fireEvent.keyDown(window, { key: "/" });

    await waitFor(() => expect(screen.getByPlaceholderText("Search sessions…")).toHaveFocus());
  });
});

function makeAgentMessage(text: string): AgentMessage {
  return {
    text,
    phase: "final_answer",
    timestamp: "2026-08-20T10:01:00Z",
    is_reasoning: false,
  };
}

function makeTurn(id: string, answer: string): CodexTurn {
  return {
    turn_id: id,
    started_at: 1_787_216_400,
    completed_at: 1_787_216_460,
    duration_ms: 60_000,
    status: "complete",
    user_message: `Request ${id}`,
    agent_messages: [makeAgentMessage(answer)],
    tool_calls: [],
    final_answer: answer,
    total_tokens: null,
    model: "gpt-5",
    cwd: "/workspace/project",
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

function makeLoadedSession(info: CodexSessionInfo, turns: CodexTurn[]): CodexSession {
  return {
    id: info.id,
    timestamp: info.start_time,
    cwd: info.cwd,
    originator: null,
    cli_version: null,
    model_provider: null,
    git: null,
    instructions: null,
    turns,
    is_ongoing: false,
    total_tokens: null,
    thread_name: info.thread_name,
    spawned_worker_ids: [],
    ai_title: null,
    path: info.path,
    is_headless: false,
    has_missing_spawn_metadata: false,
    is_archived: false,
    approval_mode: null,
    history_base_thread_id: null,
    pagination: null,
  };
}

describe("App turn navigation and search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const info = makeSession();
    mocks.sessions.splice(0, mocks.sessions.length, info);
    mocks.sessionPath = info.path;
    mocks.session = makeLoadedSession(info, [
      makeTurn("first", "First reply"),
      makeTurn("second", "Second searchable reply"),
    ]);
  });

  it("uses n and p to move between replies while viewing turn detail", async () => {
    render(<App />);
    fireEvent.click(screen.getAllByText("Batch copy session")[0].closest('[role="button"]')!);
    fireEvent.click((await screen.findAllByText("Detail", { selector: "button" }))[0]);
    await screen.findByRole("button", { name: /Back/ });

    expect(screen.getByText("First reply")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.getByText("Second searchable reply")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "p" });
    expect(screen.getByText("First reply")).toBeInTheDocument();
  });

  it("opens detail search with slash and limits results to the current turn", async () => {
    render(<App />);
    fireEvent.click(screen.getAllByText("Batch copy session")[0].closest('[role="button"]')!);
    fireEvent.click((await screen.findAllByText("Detail", { selector: "button" }))[0]);
    await screen.findByRole("button", { name: /Back/ });

    fireEvent.keyDown(window, { key: "/" });
    const search = await screen.findByRole("textbox", { name: "Search this turn" });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "second searchable" } });

    expect(screen.getByText("No matches in this turn.")).toBeInTheDocument();
  });

  it("opens list search with slash and filters turns in the current session", async () => {
    render(<App />);
    fireEvent.click(screen.getAllByText("Batch copy session")[0].closest('[role="button"]')!);
    await screen.findByText("First reply");

    fireEvent.keyDown(window, { key: "/" });
    const search = await screen.findByRole("textbox", { name: "Search turns" });
    fireEvent.change(search, { target: { value: "second searchable" } });

    expect(screen.queryByText("First reply")).not.toBeInTheDocument();
    expect(screen.getByText("Second searchable reply")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Detail", { selector: "button" }));
    fireEvent.click(await screen.findByRole("button", { name: /Back/ }));

    expect(screen.getByText("First reply")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Search turns" })).not.toBeInTheDocument();
  });

  it("keeps the current reply stable when older turns are prepended", async () => {
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");
    const { rerender } = render(<App />);
    fireEvent.click(screen.getAllByText("Batch copy session")[0].closest('[role="button"]')!);
    await screen.findByText("First reply");

    fireEvent.click(screen.getByRole("button", { name: "Next Codex reply" }));
    fireEvent.click(screen.getByRole("button", { name: "Next Codex reply" }));
    expect(screen.getByText("2/2")).toBeInTheDocument();

    mocks.session = {
      ...mocks.session!,
      turns: [makeTurn("older", "Older reply"), ...mocks.session!.turns],
    };
    rerender(<App />);

    expect(screen.getByText("3/3")).toBeInTheDocument();
    scrollSpy.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Previous Codex reply" }));
    expect(scrollSpy.mock.contexts.at(-1)).toBe(document.querySelector('[data-turn-index="1"]'));
    scrollSpy.mockRestore();
  });

  it("opens a session on its newest turn, not its oldest", async () => {
    // The transcript is paged from the newest end, so index 0 is the oldest
    // loaded turn. Selecting it on open scrolled the reader to the top of the
    // backlog, which reads as "this session starts in the past".
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");
    const { container } = render(<App />);
    fireEvent.click(screen.getAllByText("Batch copy session")[0].closest('[role="button"]')!);
    await screen.findByText("First reply");

    const selected = container.querySelectorAll(".message--selected");
    expect(selected.length).toBeGreaterThan(0);
    const selectedTurn = selected[0].closest("[data-turn-index]");
    expect(selectedTurn).toHaveAttribute("data-turn-index", "1");

    scrollSpy.mockRestore();
  });

  it("opens the session named in the address bar", async () => {
    // herdr links straight to a conversation as `/<provider>/<session-id>`; the
    // app must open that session on load instead of showing the picker.
    window.history.replaceState(null, "", "/codex/01900000-0000-7000-8000-000000000001");
    render(<App />);

    await waitFor(() =>
      expect(mocks.loadSession).toHaveBeenCalledWith("/sessions/2026/08/20/rollout-session.jsonl"),
    );
    expect(await screen.findByText("First reply")).toBeInTheDocument();
  });

  it("names the open session in the address bar", async () => {
    window.history.replaceState(null, "", "/");
    render(<App />);
    fireEvent.click(screen.getAllByText("Batch copy session")[0].closest('[role="button"]')!);
    await screen.findByText("First reply");

    // The link is only useful if opening a session updates the URL.
    expect(window.location.pathname).toBe("/codex/01900000-0000-7000-8000-000000000001");
  });

  it("reports a link to a session this machine does not have", async () => {
    // A stale or foreign link must not leave the app stuck on a blank screen.
    window.history.replaceState(null, "", "/pi/does-not-exist-here");
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/not found on this machine/i),
    );
    expect(mocks.loadSession).not.toHaveBeenCalled();
  });

  it("clears the session from the address bar when going back to the picker", async () => {
    window.history.replaceState(null, "", "/");
    render(<App />);
    fireEvent.click(screen.getAllByText("Batch copy session")[0].closest('[role="button"]')!);
    await screen.findByText("First reply");
    expect(window.location.pathname).not.toBe("/");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(window.location.pathname).toBe("/"));
  });

  it("stays in the transcript when a reply is clicked", async () => {
    // Only the Detail button leaves the transcript. Clicking the reply body used
    // to navigate, so there was no way to select or read it in place.
    window.history.replaceState(null, "", "/");
    const { container } = render(<App />);
    fireEvent.click(screen.getAllByText("Batch copy session")[0].closest('[role="button"]')!);
    await screen.findByText("First reply");

    fireEvent.click(container.querySelector(".message--claude")!);

    // Still the list view: the transcript is up and the detail page is not.
    expect(container.querySelector(".message-list")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back/ })).not.toBeInTheDocument();
  });
});
