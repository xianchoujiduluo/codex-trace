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
    const { container } = render(<ActivityTimeline turn={makeTurn()} onOpenDetail={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a muted line per tool call with kind label and command summary", () => {
    render(
      <ActivityTimeline
        turn={makeTurn({ tool_calls: [EXEC_TOOL], tool_call_orders: [0] })}
        onOpenDetail={vi.fn()}
      />,
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
        onOpenDetail={vi.fn()}
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
        onOpenDetail={vi.fn()}
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
        onOpenDetail={vi.fn()}
      />,
    );
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
  });

  it("opens the turn detail when a tool line is clicked", () => {
    const onOpenDetail = vi.fn();
    render(
      <ActivityTimeline
        turn={makeTurn({ tool_calls: [EXEC_TOOL], tool_call_orders: [0] })}
        onOpenDetail={onOpenDetail}
      />,
    );
    fireEvent.click(screen.getByText("cargo test"));
    expect(onOpenDetail).toHaveBeenCalledOnce();
  });

  it("renders thinking lines that expand to the reasoning text", () => {
    const reasoning: AgentMessage = {
      text: "Need to inspect the parser first.",
      phase: null,
      timestamp: "",
      is_reasoning: true,
      order: 1,
    };
    render(
      <ActivityTimeline turn={makeTurn({ agent_messages: [reasoning] })} onOpenDetail={vi.fn()} />,
    );
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
        onOpenDetail={vi.fn()}
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
        onOpenDetail={vi.fn()}
      />,
    );
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("BottomBar")).toBeInTheDocument();
  });
});
