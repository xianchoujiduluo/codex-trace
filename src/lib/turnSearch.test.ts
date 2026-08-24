import { describe, expect, it } from "vitest";
import type { CodexToolCall, CodexTurn } from "../../shared/types";
import { matchesTurn, toolSearchText } from "./turnSearch";

function makeTool(overrides: Partial<CodexToolCall> = {}): CodexToolCall {
  return {
    call_id: "tool-1",
    kind: "exec_command",
    name: "exec_command",
    arguments: {},
    input_text: null,
    output: null,
    exit_code: 0,
    command: ["echo", "hello"],
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
    ...overrides,
  };
}

function makeTurn(tool: CodexToolCall): CodexTurn {
  return {
    turn_id: "turn-1",
    started_at: null,
    completed_at: null,
    duration_ms: null,
    status: "complete",
    user_message: "User text",
    agent_messages: [],
    tool_calls: [tool],
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

describe("turn search", () => {
  it("matches nested tool content consistently", () => {
    const tool = makeTool({
      nested_tool_calls: [
        {
          name: "search",
          kind: "mcp_tool",
          arguments: { query: "unique nested value" },
          input_text: null,
          command: null,
          cwd: null,
          mcp_server: "docs",
          mcp_tool: "search",
        },
      ],
    });

    expect(toolSearchText(tool)).toContain("unique nested value");
    expect(matchesTurn(makeTurn(tool), "NESTED VALUE")).toBe(true);
  });
});
