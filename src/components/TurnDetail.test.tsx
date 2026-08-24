import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentMessage,
  CodexToolCall,
  CodexTurn,
  TokenInfo,
  TokenUsage,
} from "../../shared/types";
import { TurnDetail } from "./TurnDetail";

const TOKEN_INFO: TokenInfo = {
  input_tokens: 38_000,
  cached_input_tokens: 12_000,
  output_tokens: 2_000,
  reasoning_output_tokens: 500,
  total_tokens: 40_000,
  context_window_tokens: 26_000,
  model_context_window: 100_000,
  rate_limits: null,
};

const TURN_TOKEN_USAGE: TokenUsage = {
  input_tokens: 38_000,
  cached_input_tokens: 12_000,
  output_tokens: 2_000,
  reasoning_output_tokens: 500,
  total_tokens: 40_000,
};

const FINAL_MSG: AgentMessage = {
  text: "Done",
  phase: "final_answer",
  timestamp: "2026-04-26T10:01:00Z",
  is_reasoning: false,
};

function makeTurn(overrides: Partial<CodexTurn> = {}): CodexTurn {
  return {
    turn_id: "turn-1",
    started_at: 1745661600,
    completed_at: 1745661660,
    duration_ms: 60000,
    status: "complete",
    user_message: "Hello Codex",
    agent_messages: [FINAL_MSG],
    tool_calls: [],
    final_answer: "Done",
    turn_tokens: TURN_TOKEN_USAGE,
    total_tokens: TOKEN_INFO,
    model: "gpt-5.4",
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

function makeTool(overrides: Partial<CodexToolCall> = {}): CodexToolCall {
  return {
    call_id: "call-1",
    kind: "exec_command",
    name: "shell",
    arguments: {},
    input_text: null,
    output: "out",
    exit_code: 0,
    command: ["echo", "hi"],
    cwd: "/tmp",
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

function renderTurnDetail(turn: CodexTurn) {
  render(<TurnDetail turn={turn} expanded={new Set()} onToggle={vi.fn()} onBack={vi.fn()} />);
}

describe("TurnDetail", () => {
  it("shows context-left metadata using Codex's last-token usage", () => {
    renderTurnDetail(makeTurn());

    expect(screen.getByText("ctx 84% left")).toBeInTheDocument();
    expect(document.querySelector(".info-bar__context-fill")).toHaveStyle({ width: "16%" });
    expect(screen.getByText("1m")).toBeInTheDocument();
    expect(screen.getByText("This turn")).toBeInTheDocument();
    expect(screen.getByText("total 28.0k")).toBeInTheDocument();
    expect(screen.getByText("input 26.0k")).toBeInTheDocument();
    expect(screen.getByText("cached 12.0k")).toBeInTheDocument();
    expect(screen.getByText("output 2.0k")).toBeInTheDocument();
    expect(screen.getByText("reasoning 500")).toBeInTheDocument();
  });

  it("omits context-left metadata when last-token usage is unavailable", () => {
    renderTurnDetail(
      makeTurn({
        total_tokens: {
          ...TOKEN_INFO,
          context_window_tokens: null,
        },
      }),
    );

    expect(screen.queryByText(/ctx .* left/)).not.toBeInTheDocument();
    expect(screen.getByText("1m")).toBeInTheDocument();
    expect(screen.getByText("total 28.0k")).toBeInTheDocument();
  });

  it("shows the original terminal error in turn detail", () => {
    renderTurnDetail(
      makeTurn({
        status: "error",
        error: "exceeded retry limit, last status: 429 Too Many Requests",
      }),
    );

    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(
      screen.getByText("exceeded retry limit, last status: 429 Too Many Requests"),
    ).toBeInTheDocument();
  });

  it("renders assistant commentary as an inline Complementary item without duplication", () => {
    const msg: AgentMessage = {
      text: "COMMENTARY_TEXT",
      phase: "commentary",
      timestamp: "2026-04-26T10:00:00Z",
      is_reasoning: false,
      order: 0,
    };
    const { container } = render(
      <TurnDetail
        turn={makeTurn({ agent_messages: [msg], tool_calls: [], final_answer: null })}
        expanded={new Set()}
        onToggle={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    // Shown as a labelled Complementary item with its prose inline (no expansion needed)...
    expect(screen.getByText("Complementary")).toBeInTheDocument();
    expect(screen.getByText("COMMENTARY_TEXT")).toBeInTheDocument();
    // ...and exactly once — no duplicated flattened blob above the timeline.
    const occurrences = (container.textContent ?? "").split("COMMENTARY_TEXT").length - 1;
    expect(occurrences).toBe(1);
  });

  it("interleaves tool calls with commentary by stream order", () => {
    const first: AgentMessage = {
      text: "FIRST_MESSAGE",
      phase: "commentary",
      timestamp: "2026-04-26T10:00:00Z",
      is_reasoning: false,
      order: 0,
    };
    const second: AgentMessage = {
      text: "SECOND_MESSAGE",
      phase: "commentary",
      timestamp: "2026-04-26T10:00:02Z",
      is_reasoning: false,
      order: 2,
    };
    // Tool call's stream order (1) sits between the two messages (0 and 2), so it must render
    // between them — not after both.
    const tool = makeTool({ call_id: "c1", command: ["TOOL_MARKER_CMD"] });
    const { container } = render(
      <TurnDetail
        turn={makeTurn({
          agent_messages: [first, second],
          tool_calls: [tool],
          tool_call_orders: [1],
          final_answer: null,
        })}
        expanded={new Set([0])}
        onToggle={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    const text = container.textContent ?? "";
    const iFirst = text.indexOf("FIRST_MESSAGE");
    const iTool = text.indexOf("TOOL_MARKER_CMD");
    const iSecond = text.indexOf("SECOND_MESSAGE");
    expect(iFirst).toBeGreaterThanOrEqual(0);
    expect(iTool).toBeGreaterThan(iFirst);
    expect(iSecond).toBeGreaterThan(iTool);
  });

  it("replaces a redundant Code Mode wrapper with collapsed raw details", () => {
    const wrapper = makeTool({
      call_id: "outer-exec",
      kind: "code_mode",
      name: "exec",
      command: null,
      input_text: "text(await tools.apply_patch(patch));",
      output: "{}",
      nested_tool_calls: [
        {
          name: "apply_patch",
          kind: "patch_apply",
          arguments: {},
          input_text: "*** Begin Patch\n*** Update File: src/main.rs\n*** End Patch",
          command: null,
          cwd: null,
          mcp_server: null,
          mcp_tool: null,
        },
      ],
    });
    const fileChange = makeTool({
      call_id: "file-change",
      kind: "patch_apply",
      name: "file_change",
      command: null,
      exit_code: null,
      patch_changes: {
        "src/main.rs": { type: "update", unified_diff: "@@ -1 +1 @@\n-a\n+b" },
      },
    });
    const { container } = render(
      <TurnDetail
        turn={makeTurn({
          agent_messages: [],
          tool_calls: [fileChange, wrapper],
          tool_call_orders: [11, 10],
          final_answer: null,
        })}
        expanded={new Set([0])}
        onToggle={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText("Raw exec details")).toBeInTheDocument();
    expect(container.querySelector(".tool-call__raw-details")).not.toHaveAttribute("open");
    expect(container.querySelectorAll(".tool-call")).toHaveLength(1);
    expect(screen.getByText("Edited")).toBeInTheDocument();
  });

  it("keeps Code Mode visible when no structured item represents it", () => {
    renderTurnDetail(
      makeTurn({
        agent_messages: [],
        tool_calls: [
          makeTool({
            kind: "code_mode",
            name: "exec",
            command: null,
            nested_tool_calls: [],
          }),
        ],
        tool_call_orders: [10],
        final_answer: null,
      }),
    );

    expect(screen.getByText("exec")).toBeInTheDocument();
    expect(screen.queryByText("Raw exec details")).not.toBeInTheDocument();
  });

  // Codex v0.146.0 (issue #211): skill catalog budget/truncation notices arrive as
  // `EventMsg::Warning` and are surfaced per-turn via `CodexTurn.warnings`.
  it("shows warnings, e.g. a skill catalog budget notice", () => {
    renderTurnDetail(
      makeTurn({
        warnings: ["Skill catalog exceeded its context budget; 3 additional skills omitted."],
      }),
    );

    expect(screen.getByText("Warnings")).toBeInTheDocument();
    expect(
      screen.getByText("Skill catalog exceeded its context budget; 3 additional skills omitted."),
    ).toBeInTheDocument();
  });

  it("omits the Warnings section when there are no warnings", () => {
    renderTurnDetail(makeTurn());

    expect(screen.queryByText("Warnings")).not.toBeInTheDocument();
  });

  it("copies the complete original final answer", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const text = "Summary\n\n- first\n- second\n\n`inline code`";
    renderTurnDetail(
      makeTurn({
        agent_messages: [{ ...FINAL_MSG, text }],
        final_answer: text,
      }),
    );

    const copyButton = screen.getByRole("button", { name: "Copy Final answer content" });
    expect(copyButton.nextElementSibling).toHaveClass("turn-detail__msg-time");
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(text));
    expect(screen.getByRole("button", { name: "Copied Final answer content" })).toBeVisible();
  });

  it("filters detail content within the current turn", () => {
    const matchingMessage: AgentMessage = {
      text: "Unique detail needle",
      phase: "commentary",
      timestamp: "2026-04-26T10:00:00Z",
      is_reasoning: false,
      order: 0,
    };
    render(
      <TurnDetail
        turn={makeTurn({
          agent_messages: [matchingMessage, FINAL_MSG],
          final_answer: FINAL_MSG.text,
        })}
        expanded={new Set()}
        onToggle={vi.fn()}
        onBack={vi.fn()}
        searchQuery="detail needle"
      />,
    );

    expect(screen.getByText("Unique detail needle")).toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });

  it("shows an empty result when the current turn has no search match", () => {
    render(
      <TurnDetail
        turn={makeTurn()}
        expanded={new Set()}
        onToggle={vi.fn()}
        onBack={vi.fn()}
        searchQuery="not present"
      />,
    );

    expect(screen.getByText("No matches in this turn.")).toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });
});
