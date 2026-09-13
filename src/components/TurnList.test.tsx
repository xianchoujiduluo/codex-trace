import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type {
  AgentMessage,
  CodexToolCall,
  CodexTurn,
  TokenInfo,
  TokenUsage,
} from "../../shared/types";
import { TurnList } from "./TurnList";

const TOKEN_INFO: TokenInfo = {
  input_tokens: 100,
  cached_input_tokens: 0,
  output_tokens: 50,
  reasoning_output_tokens: 0,
  total_tokens: 150,
  context_window_tokens: 150,
  model_context_window: 8000,
  rate_limits: null,
};

const TURN_TOKEN_USAGE: TokenUsage = {
  input_tokens: 100,
  cached_input_tokens: 0,
  output_tokens: 50,
  reasoning_output_tokens: 0,
  total_tokens: 150,
};

const FINAL_MSG: AgentMessage = {
  text: "Hi there!",
  phase: "final_answer",
  timestamp: "2026-04-26T10:01:00Z",
  is_reasoning: false,
};

const EXEC_TOOL: CodexToolCall = {
  call_id: "c1",
  kind: "exec_command",
  name: "shell",
  arguments: {},
  input_text: null,
  output: "ok",
  exit_code: 0,
  command: ["ls"],
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
    user_message: "Hello Codex",
    agent_messages: [FINAL_MSG],
    tool_calls: [],
    final_answer: "Hi there!",
    turn_tokens: TURN_TOKEN_USAGE,
    total_tokens: TOKEN_INFO,
    model: "gpt-4",
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

describe("TurnList", () => {
  beforeAll(() => {
    // jsdom does not implement element scrolling.
    Object.defineProperty(Element.prototype, "scrollTo", {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  });

  it("shows empty state message when there are no turns", () => {
    render(<TurnList turns={[]} selectedIndex={-1} onSelectTurn={vi.fn()} />);
    expect(screen.getByText("No turns in this session.")).toBeInTheDocument();
  });

  it("renders the user message text", () => {
    render(<TurnList turns={[makeTurn()]} selectedIndex={-1} onSelectTurn={vi.fn()} />);
    // The question text appears in the bubble and in the minimap tooltip.
    expect(screen.getAllByText("Hello Codex").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the agent final answer as preview", () => {
    render(<TurnList turns={[makeTurn()]} selectedIndex={-1} onSelectTurn={vi.fn()} />);
    expect(screen.getByText("Hi there!")).toBeInTheDocument();
  });

  it("shows user messages expanded and Codex messages collapsed by default", () => {
    const { container } = render(
      <TurnList turns={[makeTurn()]} selectedIndex={-1} onSelectTurn={vi.fn()} />,
    );

    const userMessage = container.querySelector(".message--user .message__content")!;
    const codexMessage = container.querySelector(".message--claude .message__content")!;
    expect(userMessage).not.toHaveClass("message__content--collapsed");
    expect(codexMessage).toHaveClass("message__content--collapsed");

    fireEvent.click(userMessage.closest(".message--user")!);
    expect(userMessage).toHaveClass("message__content--collapsed");
  });

  it("marks a turn that spawned a subagent", () => {
    render(
      <TurnList
        turns={[
          makeTurn({
            collab_spawns: [
              {
                call_id: "spawn-1",
                new_session_id: "worker-1",
                agent_nickname: "Socrates",
                agent_role: "worker",
                model: null,
                reasoning_effort: null,
                prompt_preview: "Review the implementation",
              },
            ],
          }),
        ]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Uses 1 subagent")).toHaveAttribute("title", "Uses 1 subagent");
    expect(document.querySelector(".turn-list__turn")).toHaveClass("turn-list__turn--subagent");
  });

  it("marks subagent activity when the worker count is unavailable", () => {
    render(
      <TurnList
        turns={[
          makeTurn({
            tool_calls: [{ ...EXEC_TOOL, kind: "wait_agent", name: "wait_agent" }],
          }),
        ]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Uses subagents")).toHaveAttribute("title", "Uses subagents");
    expect(document.querySelector(".turn-list__turn")).toHaveClass("turn-list__turn--subagent");
  });

  it("does not mark a turn without subagent activity", () => {
    render(<TurnList turns={[makeTurn()]} selectedIndex={-1} onSelectTurn={vi.fn()} />);

    expect(document.querySelector(".turn-list__turn")).not.toHaveClass("turn-list__turn--subagent");
  });

  it("renders one activity line per tool call with kind and summary", () => {
    render(
      <TurnList
        turns={[makeTurn({ tool_calls: [EXEC_TOOL] })]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );
    expect(screen.getByText("Shell")).toBeInTheDocument();
    expect(screen.getByText("ls")).toBeInTheDocument();
  });

  it("renders one activity line per tool call for multiple calls", () => {
    const tool2 = { ...EXEC_TOOL, call_id: "c2" };
    render(
      <TurnList
        turns={[makeTurn({ tool_calls: [EXEC_TOOL, tool2] })]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Shell")).toHaveLength(2);
  });

  it("shows ongoing dot for an ongoing turn", () => {
    render(
      <TurnList
        turns={[makeTurn({ status: "ongoing", completed_at: null })]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );
    expect(document.querySelector(".ongoing-dots")).toBeInTheDocument();
  });

  it("does not show ongoing dot for a completed turn", () => {
    render(<TurnList turns={[makeTurn()]} selectedIndex={-1} onSelectTurn={vi.fn()} />);
    expect(document.querySelector(".ongoing-dots")).not.toBeInTheDocument();
  });

  it("shows token stat when total_tokens is set", () => {
    render(<TurnList turns={[makeTurn()]} selectedIndex={-1} onSelectTurn={vi.fn()} />);
    expect(screen.getByText("150 tok")).toBeInTheDocument();

    const tokenStat = document.querySelector(".message__stat--tokens");
    expect(tokenStat).toHaveAttribute("title", expect.stringContaining("Input: 100"));
    expect(tokenStat).toHaveAttribute("title", expect.stringContaining("Output: 50"));
    expect(tokenStat).toHaveAttribute("title", expect.stringContaining("Total: 150"));
  });

  it("shows duration stat when duration_ms is set", () => {
    render(<TurnList turns={[makeTurn()]} selectedIndex={-1} onSelectTurn={vi.fn()} />);
    expect(screen.getByText("1m")).toBeInTheDocument();
  });

  it("shows a terminal turn error as the Codex message preview", () => {
    render(
      <TurnList
        turns={[
          makeTurn({
            status: "error",
            error: "exceeded retry limit, last status: 429 Too Many Requests",
            agent_messages: [],
            final_answer: null,
          }),
        ]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    expect(
      screen.getByText("exceeded retry limit, last status: 429 Too Many Requests"),
    ).toHaveClass("message__content--error");
    expect(screen.getByText("Detail", { selector: "button" })).toBeInTheDocument();
  });

  it("calls onSelectTurn with the turn index when Detail button is clicked", () => {
    const onSelect = vi.fn();
    render(<TurnList turns={[makeTurn()]} selectedIndex={-1} onSelectTurn={onSelect} />);
    fireEvent.click(screen.getByText(/Detail/));
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("applies selected class to the currently selected turn", () => {
    render(<TurnList turns={[makeTurn()]} selectedIndex={0} onSelectTurn={vi.fn()} />);
    const msgs = document.querySelectorAll(".message--selected");
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("shows reasoning count when reasoning messages are present", () => {
    const reasoningMsg: AgentMessage = {
      text: "thinking...",
      phase: null,
      timestamp: "2026-04-26T10:00:30Z",
      is_reasoning: true,
    };
    render(
      <TurnList
        turns={[makeTurn({ agent_messages: [reasoningMsg, FINAL_MSG] })]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );
    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });

  it("filters turns within the current session", () => {
    render(
      <TurnList
        turns={[
          makeTurn({ turn_id: "match", user_message: "Find this request" }),
          makeTurn({ turn_id: "other", user_message: "Different request" }),
        ]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
        searchQuery="find this"
      />,
    );

    expect(screen.getAllByText("Find this request").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Different request")).not.toBeInTheDocument();
  });

  it("shows no matching state when a session turn search has no result", () => {
    render(
      <TurnList
        turns={[makeTurn({ turn_id: "t0", user_message: "Hello" })]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
        searchQuery="missing"
      />,
    );

    expect(screen.getByText("No matching turns in this session.")).toBeInTheDocument();
  });

  it("offers to load older turns for a backward paged session", () => {
    const onLoadMore = vi.fn();
    render(
      <TurnList
        turns={[makeTurn()]}
        selectedIndex={0}
        onSelectTurn={vi.fn()}
        pagination={{
          direction: "backward",
          next_cursor: 1,
          has_more: true,
          total_turns: 4,
          source_size_bytes: 20_000_000,
          page_bytes: 10_000_000,
        }}
        onLoadMore={onLoadMore}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Load older turns/ }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});

describe("TurnList chat layout", () => {
  it("renders one minimap tick per question with the question as tooltip", () => {
    render(
      <TurnList
        turns={[
          makeTurn({ turn_id: "t1", user_message: "First question" }),
          makeTurn({ turn_id: "t2", user_message: "Second question" }),
        ]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    const ticks = screen.getAllByRole("button", { name: /Jump to question/ });
    expect(ticks).toHaveLength(2);
    // Each question text appears in both the bubble and the minimap tooltip.
    expect(screen.getAllByText("First question").length).toBe(2);
    expect(screen.getAllByText("Second question").length).toBe(2);
  });

  it("marks the active question tick", () => {
    render(
      <TurnList
        turns={[
          makeTurn({ turn_id: "t1", user_message: "First question" }),
          makeTurn({ turn_id: "t2", user_message: "Second question" }),
        ]}
        selectedIndex={1}
        onSelectTurn={vi.fn()}
      />,
    );

    const ticks = screen.getAllByRole("button", { name: /Jump to question/ });
    expect(ticks[0]).not.toHaveClass("turn-minimap__tick--active");
    expect(ticks[1]).toHaveClass("turn-minimap__tick--active");
  });

  it("scrolls to the turn when its minimap tick is clicked", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <TurnList
        turns={[
          makeTurn({ turn_id: "t1", user_message: "First question" }),
          makeTurn({ turn_id: "t2", user_message: "Second question" }),
        ]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    const ticks = screen.getAllByRole("button", { name: /Second question/ });
    fireEvent.click(ticks[0]);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("labels assistant messages with the session provider", () => {
    const { container, rerender } = render(
      <TurnList turns={[makeTurn()]} selectedIndex={-1} onSelectTurn={vi.fn()} />,
    );
    expect(container.querySelector(".message__role--claude")?.textContent).toBe("Codex");

    rerender(
      <TurnList turns={[makeTurn()]} selectedIndex={-1} onSelectTurn={vi.fn()} providerName="pi" />,
    );
    expect(container.querySelector(".message__role--claude")?.textContent).toBe("pi");
  });

  it("keeps the user message in a right-aligned bubble container", () => {
    const { container } = render(
      <TurnList turns={[makeTurn()]} selectedIndex={-1} onSelectTurn={vi.fn()} />,
    );
    const userBubble = container.querySelector(".message--user");
    expect(userBubble).toBeInTheDocument();
    expect(userBubble).toHaveClass("message");
  });
});
