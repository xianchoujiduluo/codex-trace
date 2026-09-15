import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentMessage, CodexToolCall, CodexTurn } from "../../shared/types";
import { ActivityTimeline } from "./ActivityTimeline";

const EXEC_TOOL: CodexToolCall = {
  call_id: "c1",
  kind: "exec_command",
  name: "shell",
  arguments: {},
  input_text: null,
  output: "ok",
  exit_code: 0,
  command: ["cargo", "test"],
  cwd: null,
  duration_secs: 0.1,
  mcp_server: null,
  mcp_tool: null,
  plugin_id: null,
  script_path: null,
  patch_success: null,
  patch_changes: null,
  web_query: null,
  web_url: null,
  image_prompt: null,
  image_file_path: null,
  worker_session: null,
  status: "completed",
  subagent_id: null,
  subagent_name: null,
  output_truncated: null,
};

function makeTurn(overrides: Partial<CodexTurn> = {}): CodexTurn {
  return {
    turn_id: "turn-1",
    started_at: 1745661600,
    completed_at: 1745661660,
    duration_ms: 60000,
    status: "complete",
    user_message: "Hello",
    agent_messages: [],
    tool_calls: [],
    tool_call_orders: [],
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
    ...overrides,
  };
}

describe("ActivityTimeline", () => {
  it("renders nothing when the turn has no tools or reasoning", () => {
    const { container } = render(<ActivityTimeline turn={makeTurn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a muted line per tool call with kind label and command summary", () => {
    render(
      <ActivityTimeline turn={makeTurn({ tool_calls: [EXEC_TOOL], tool_call_orders: [0] })} />,
    );
    expect(screen.getByText("Shell")).toBeInTheDocument();
    expect(screen.getByText("cargo test")).toBeInTheDocument();
  });

  it("summarises mcp tools as server::tool", () => {
    render(
      <ActivityTimeline
        turn={makeTurn({
          tool_calls: [
            {
              ...EXEC_TOOL,
              kind: "mcp_tool",
              command: null,
              mcp_server: "github",
              mcp_tool: "create_issue",
            },
          ],
          tool_call_orders: [0],
        })}
      />,
    );
    expect(screen.getByText("MCP")).toBeInTheDocument();
    expect(screen.getByText("github::create_issue")).toBeInTheDocument();
  });

  it("flags failed tool calls", () => {
    render(
      <ActivityTimeline
        turn={makeTurn({
          tool_calls: [{ ...EXEC_TOOL, status: "failed" }],
          tool_call_orders: [0],
        })}
      />,
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("shows added and removed line counts for patch tools", () => {
    render(
      <ActivityTimeline
        turn={makeTurn({
          tool_calls: [
            {
              ...EXEC_TOOL,
              kind: "patch_apply",
              command: null,
              patch_changes: {
                "src/main.rs": {
                  type: "modify",
                  unified_diff: "@@ -1,2 +1,2 @@\n-old\n+new\n+newer\n",
                },
              },
            },
          ],
          tool_call_orders: [0],
        })}
      />,
    );
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
  });

  it("expands a tool line in place instead of leaving for the turn detail", () => {
    const { container } = render(
      <ActivityTimeline turn={makeTurn({ tool_calls: [EXEC_TOOL], tool_call_orders: [0] })} />,
    );
    const line = container.querySelector(".activity-line")!;
    expect(container.querySelector(".activity-tool-body")).not.toBeInTheDocument();

    // Click the line itself, not its summary text: once the body is open the
    // command also appears inside it, so the text alone is ambiguous.
    fireEvent.click(line);
    const body = container.querySelector(".activity-tool-body")!;
    // The full tool body — not a navigation away from the transcript.
    expect(body).toBeInTheDocument();
    expect(body.querySelector(".tool-call__cmd")).toHaveTextContent("cargo test");
    expect(body.querySelector(".tool-call__output")).toHaveTextContent("ok");

    fireEvent.click(line);
    expect(container.querySelector(".activity-tool-body")).not.toBeInTheDocument();
  });

  it("scrolls a freshly expanded tool body into view", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { container } = render(
      <ActivityTimeline turn={makeTurn({ tool_calls: [EXEC_TOOL], tool_call_orders: [0] })} />,
    );

    fireEvent.click(container.querySelector(".activity-line")!);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
  });

  it("scopes the scroll to the tool that was opened, not the one still open", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const second = { ...EXEC_TOOL, call_id: "c2", command: ["cargo", "build"] };
    const { container } = render(
      <ActivityTimeline
        turn={makeTurn({ tool_calls: [EXEC_TOOL, second], tool_call_orders: [0, 1] })}
      />,
    );

    const lines = container.querySelectorAll(".activity-line");
    fireEvent.click(lines[0]);
    fireEvent.click(lines[1]);
    scrollIntoView.mockClear();

    // Collapsing the first leaves the second open; the scroll must not follow
    // the survivor, which the browser would treat as a jarring hop.
    fireEvent.click(lines[0]);
    const open = container.querySelector(".activity-tool-body")!;
    expect(open.querySelector(".tool-call__cmd")).toHaveTextContent("cargo build");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("renders thinking lines that expand to the reasoning text", () => {
    const reasoning: AgentMessage = {
      text: "Need to inspect the parser first.",
      phase: null,
      timestamp: "",
      is_reasoning: true,
      order: 1,
    };
    render(<ActivityTimeline turn={makeTurn({ agent_messages: [reasoning] })} />);
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.queryByText(/Need to inspect the parser/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Thinking"));
    expect(screen.getByText(/Need to inspect the parser/)).toBeVisible();
  });
});

describe("ActivityTimeline friendly summaries", () => {
  it("labels generic file tools by name and shows the path target", () => {
    render(
      <ActivityTimeline
        turn={makeTurn({
          tool_calls: [
            {
              ...EXEC_TOOL,
              kind: "unknown",
              name: "read",
              command: null,
              input_text: '{"path":"src/components/ViewToolbar.tsx","limit":30}',
              arguments: { path: "src/components/ViewToolbar.tsx", limit: 30 },
            },
          ],
          tool_call_orders: [0],
        })}
      />,
    );
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("src/components/ViewToolbar.tsx")).toBeInTheDocument();
    expect(screen.queryByText(/"path"/)).not.toBeInTheDocument();
  });

  it("falls back to search pattern when no path field exists", () => {
    render(
      <ActivityTimeline
        turn={makeTurn({
          tool_calls: [
            {
              ...EXEC_TOOL,
              kind: "unknown",
              name: "grep",
              command: null,
              arguments: { pattern: "BottomBar", output_mode: "content" },
            },
          ],
          tool_call_orders: [0],
        })}
      />,
    );
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("BottomBar")).toBeInTheDocument();
  });
});
