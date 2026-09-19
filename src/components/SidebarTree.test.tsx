import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexSessionInfo } from "../../shared/types";

const downloadSessionMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/downloadSession", () => ({ downloadSession: downloadSessionMock }));

import { SidebarTree } from "./SidebarTree";

function makeSession(overrides: Partial<CodexSessionInfo> = {}): CodexSessionInfo {
  return {
    id: "abc123",
    path: "/sessions/2026/04/26/rollout-abc.jsonl",
    cwd: "/Users/user/myproject",
    git_branch: "main",
    originator: null,
    model: "gpt-4",
    cli_version: null,
    thread_name: null,
    last_user_message: "Latest user request",
    turn_count: 3,
    start_time: "2026-04-26T10:00:00Z",
    end_time: null,
    total_tokens: null,
    is_ongoing: false,
    is_external_worker: false,
    is_inline_worker: false,
    is_headless: false,
    is_archived: false,
    approval_mode: null,
    history_base_thread_id: null,
    last_activity_time: "2026-04-26T10:00:00Z",
    file_size_bytes: 1_572_864,
    worker_nickname: null,
    worker_role: null,
    spawned_worker_ids: [],
    date_group: "2026/04/26",
    ai_title: null,
    ...overrides,
  };
}

describe("SidebarTree", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty state when no sessions", () => {
    render(
      <SidebarTree
        sessions={[]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
      />,
    );
    expect(screen.getByText("No sessions")).toBeInTheDocument();
  });

  it("renders the date group header", () => {
    render(
      <SidebarTree
        sessions={[makeSession()]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
      />,
    );
    expect(screen.getByText("2026/04/26")).toBeInTheDocument();
  });

  it("renders the latest user message when no thread_name exists", () => {
    render(
      <SidebarTree
        sessions={[makeSession()]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
      />,
    );
    expect(screen.getByText("Latest user request")).toHaveAttribute("title", "Latest user request");
  });

  it("renders the session file size", () => {
    render(
      <SidebarTree
        sessions={[makeSession()]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
      />,
    );
    expect(screen.getByText("1.5 MB")).toBeInTheDocument();
  });

  it("prefers thread_name over cwd", () => {
    render(
      <SidebarTree
        sessions={[makeSession({ thread_name: "My Task" })]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
      />,
    );
    expect(screen.getByText("My Task")).toBeInTheDocument();
  });

  it("falls back to id prefix when thread_name and user message are absent", () => {
    render(
      <SidebarTree
        sessions={[makeSession({ thread_name: null, last_user_message: null })]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
      />,
    );
    expect(screen.getByText("abc123".slice(0, 8))).toBeInTheDocument();
  });

  it("calls onSelectSession when a session row is clicked", () => {
    const onSelect = vi.fn();
    const session = makeSession({ thread_name: "My Task" });
    render(
      <SidebarTree
        sessions={[session]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={onSelect}
        onToggleDate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("My Task").closest('[role="button"]')!);
    expect(onSelect).toHaveBeenCalledWith(session);
  });

  it("copies the session ID", async () => {
    const onSelect = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const session = makeSession({ id: "session-uuid" });
    render(
      <SidebarTree
        sessions={[session]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={onSelect}
        onToggleDate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy session ID" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("session-uuid"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Copied session ID" })).toBeInTheDocument();
  });

  it("copies the session path relative to the sessions directory", async () => {
    const onSelect = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const session = makeSession({
      path: "/home/user/.codex/sessions/2026/04/26/rollout-abc.jsonl",
    });
    render(
      <SidebarTree
        sessions={[session]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={onSelect}
        onToggleDate={vi.fn()}
      />,
    );

    const copyIdButton = screen.getByRole("button", { name: "Copy session ID" });
    const copyPathButton = screen.getByRole("button", { name: "Copy session path" });
    expect(copyPathButton.parentElement).toBe(copyIdButton.parentElement);
    expect(copyPathButton.parentElement).toHaveClass("sidebar-tree__copy-actions");

    fireEvent.click(copyPathButton);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("2026/04/26/rollout-abc.jsonl"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Copied session path" })).toBeInTheDocument();
  });

  it("copies the full session path from its own button", async () => {
    // Two separate buttons on purpose: the relative path is short and readable
    // inside the sessions tree, while the full path is what other tools need
    // to open the file. Replacing one with the other breaks a use case either way.
    // The copied value is anchored at `~/` rather than the backend's absolute
    // path, because in Docker that absolute path only exists inside the
    // container (`/home/app/...`) and is useless on the user's machine.
    const onSelect = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const session = makeSession({
      path: "/home/user/.codex/sessions/2026/04/26/rollout-abc.jsonl",
    });
    render(
      <SidebarTree
        sessions={[session]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={onSelect}
        onToggleDate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy full session path" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("~/.codex/sessions/2026/04/26/rollout-abc.jsonl"),
    );
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Copied full session path" })).toBeInTheDocument();
  });

  it("copies a pi session path rooted at the home directory", async () => {
    // Regression guard for Docker: the container reports its own $HOME
    // (/home/app), and that path does not exist on the host running the browser.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const session = makeSession({
      provider: "pi",
      path: "/home/app/.pi/agent/sessions/--home-administrator--/2026-09-13T13-28-18-318Z_abc.jsonl",
    });
    render(
      <SidebarTree
        sessions={[session]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy full session path" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "~/.pi/agent/sessions/--home-administrator--/2026-09-13T13-28-18-318Z_abc.jsonl",
      ),
    );
  });

  it("downloads the source session file without opening the session", async () => {
    const onSelect = vi.fn();
    const session = makeSession({
      path: "/home/user/.codex/sessions/2026/04/26/rollout-source.jsonl",
      thread_name: "Downloadable session",
    });
    render(
      <SidebarTree
        sessions={[session]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={onSelect}
        onToggleDate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download session file" }));

    await waitFor(() => expect(downloadSessionMock).toHaveBeenCalledWith(session.path));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Downloaded session file" })).toBeInTheDocument();
  });

  it("reports a source session download failure", async () => {
    const onDownloadError = vi.fn();
    downloadSessionMock.mockRejectedValueOnce(new Error("file is unavailable"));
    const session = makeSession({ thread_name: "Unavailable session" });
    render(
      <SidebarTree
        sessions={[session]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
        onDownloadError={onDownloadError}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download session file" }));

    await waitFor(() =>
      expect(onDownloadError).toHaveBeenCalledWith(
        "Could not download session file: file is unavailable",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Retry downloading session file" }),
    ).toBeInTheDocument();
  });

  it("shows checkboxes and toggles sessions without opening them in selection mode", () => {
    const onSelect = vi.fn();
    const onToggleSelection = vi.fn();
    const session = makeSession({ id: "session-uuid", thread_name: "Selectable session" });
    render(
      <SidebarTree
        sessions={[session]}
        selectedPath={null}
        selectionMode
        selectedSessionIds={new Set([session.id])}
        collapsedDates={new Set()}
        onSelectSession={onSelect}
        onToggleSessionSelection={onToggleSelection}
        onToggleDate={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Select session session-uuid" });
    expect(checkbox).toBeChecked();
    expect(screen.queryByRole("button", { name: "Copy session ID" })).not.toBeInTheDocument();

    fireEvent.click(checkbox);
    expect(onToggleSelection).toHaveBeenCalledWith(session);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("hides sessions when their date group is collapsed", () => {
    render(
      <SidebarTree
        sessions={[makeSession({ thread_name: "Hidden" })]}
        selectedPath={null}
        collapsedDates={new Set(["2026/04/26"])}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
      />,
    );
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });

  it("calls onToggleDate when the date header is clicked", () => {
    const onToggle = vi.fn();
    render(
      <SidebarTree
        sessions={[makeSession()]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={onToggle}
      />,
    );
    fireEvent.click(screen.getByText("2026/04/26"));
    expect(onToggle).toHaveBeenCalledWith("2026/04/26");
  });

  it("applies selected class to the active session", () => {
    const session = makeSession({ thread_name: "Active" });
    render(
      <SidebarTree
        sessions={[session]}
        selectedPath={session.path}
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
      />,
    );
    const el = screen.getByText("Active").closest(".sidebar-tree__session");
    expect(el).toHaveClass("sidebar-tree__session--selected");
  });

  it("groups sessions from different dates under separate headers", () => {
    const sessions = [
      makeSession({
        path: "/a.jsonl",
        thread_name: "Session A",
        last_activity_time: "2026-04-25T12:00:00Z",
      }),
      makeSession({
        path: "/b.jsonl",
        thread_name: "Session B",
        last_activity_time: "2026-04-26T12:00:00Z",
      }),
    ];
    render(
      <SidebarTree
        sessions={sessions}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
      />,
    );
    expect(screen.getByText("2026/04/25")).toBeInTheDocument();
    expect(screen.getByText("2026/04/26")).toBeInTheDocument();
    expect(screen.getByText("Session A")).toBeInTheDocument();
    expect(screen.getByText("Session B")).toBeInTheDocument();
  });

  it("orders and groups sessions by latest activity", () => {
    const { container } = render(
      <SidebarTree
        sessions={[
          makeSession({
            path: "/new-session.jsonl",
            thread_name: "New session",
            start_time: "2026-08-20T08:00:00Z",
            last_activity_time: "2026-08-20T08:01:00Z",
            date_group: "2026/08/20",
          }),
          makeSession({
            path: "/resumed-session.jsonl",
            thread_name: "Resumed old session",
            start_time: "2026-01-01T08:00:00Z",
            last_activity_time: "2026-08-20T09:00:00Z",
            date_group: "2026/01/01",
          }),
          makeSession({
            path: "/yesterday.jsonl",
            thread_name: "Yesterday",
            start_time: "2026-08-19T08:00:00Z",
            last_activity_time: "2026-08-19T09:00:00Z",
            date_group: "2026/08/19",
          }),
        ]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
      />,
    );

    expect(
      Array.from(
        container.querySelectorAll(".sidebar-tree__group-label"),
        (node) => node.textContent,
      ),
    ).toEqual(["2026/08/20", "2026/08/19"]);
    expect(
      Array.from(
        container.querySelectorAll(".sidebar-tree__session-label"),
        (node) => node.textContent,
      ),
    ).toEqual(["Resumed old session", "New session", "Yesterday"]);
  });

  it("shows only primary sessions when linked and unlinked workers are present", () => {
    const linkedWorker = makeSession({
      id: "worker1",
      path: "/sessions/2026/04/26/rollout-linked-worker.jsonl",
      thread_name: "Linked Worker",
      is_external_worker: true,
      is_inline_worker: true,
    });
    const unlinkedWorker = makeSession({
      id: "worker2",
      path: "/sessions/2026/04/26/rollout-unlinked-worker.jsonl",
      thread_name: "Unlinked Worker",
      is_external_worker: true,
    });
    const parent = makeSession({
      id: "parent1",
      path: "/sessions/2026/04/26/rollout-parent.jsonl",
      thread_name: "Parent Session",
      spawned_worker_ids: ["worker1"],
    });
    render(
      <SidebarTree
        sessions={[parent, linkedWorker, unlinkedWorker]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
      />,
    );
    expect(screen.getByText("Parent Session")).toBeInTheDocument();
    expect(screen.getByLabelText("Uses 1 subagent")).toHaveAttribute("title", "Uses 1 subagent");
    expect(screen.queryByText("Linked Worker")).not.toBeInTheDocument();
    expect(screen.queryByText("Unlinked Worker")).not.toBeInTheDocument();
    expect(screen.queryByText(/workers/)).not.toBeInTheDocument();
  });

  it("shows the empty state when only worker sessions exist", () => {
    render(
      <SidebarTree
        sessions={[
          makeSession({
            id: "worker1",
            path: "/sessions/2026/04/26/rollout-worker.jsonl",
            thread_name: "Worker Session",
            is_external_worker: true,
          }),
        ]}
        selectedPath={null}
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
      />,
    );
    expect(screen.getByText("No sessions")).toBeInTheDocument();
    expect(screen.queryByText("Worker Session")).not.toBeInTheDocument();
  });

  it("groups sessions by directory when requested", () => {
    render(
      <SidebarTree
        sessions={[
          makeSession({ thread_name: "First", cwd: "/workspace/project-a" }),
          makeSession({
            id: "second",
            path: "/second.jsonl",
            thread_name: "Second",
            cwd: "/workspace/project-b",
          }),
        ]}
        selectedPath={null}
        groupMode="directory"
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
      />,
    );

    expect(screen.getByText("project-a").closest("[title]"))?.toHaveAttribute(
      "title",
      "/workspace/project-a",
    );
    expect(screen.getByText("project-b").closest("[title]"))?.toHaveAttribute(
      "title",
      "/workspace/project-b",
    );
  });

  it("sorts directories and their sessions by oldest activity", () => {
    const { container } = render(
      <SidebarTree
        sessions={[
          makeSession({
            id: "a-newer",
            path: "/a-newer.jsonl",
            cwd: "/workspace/project-a",
            thread_name: "A newer",
            last_activity_time: "2026-08-20T10:00:00Z",
          }),
          makeSession({
            id: "project-b",
            path: "/project-b.jsonl",
            cwd: "/workspace/project-b",
            thread_name: "Project B",
            last_activity_time: "2026-08-20T11:00:00Z",
          }),
          makeSession({
            id: "a-older",
            path: "/a-older.jsonl",
            cwd: "/workspace/project-a",
            thread_name: "A older",
            last_activity_time: "2026-08-20T09:00:00Z",
          }),
        ]}
        selectedPath={null}
        groupMode="directory"
        sortOrder="oldest"
        collapsedDates={new Set()}
        onSelectSession={vi.fn()}
        onToggleDate={vi.fn()}
      />,
    );

    expect(
      Array.from(
        container.querySelectorAll(".sidebar-tree__group-label"),
        (node) => node.textContent,
      ),
    ).toEqual(["project-a", "project-b"]);
    expect(
      Array.from(
        container.querySelectorAll(".sidebar-tree__session-label"),
        (node) => node.textContent,
      ),
    ).toEqual(["A older", "A newer", "Project B"]);
  });
});
