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
import { formatExactTime } from "../lib/format";
import { MAX_TICK_PITCH, minimapLayout } from "../lib/minimap";

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

  it("previews the closing message, not the first prose of a chat-provider turn", () => {
    // pi and Claude Code set no `phase` and stream prose between tool calls; the
    // turn the transcript was previewing opened with "看懂了目标界面…" while the
    // actual answer sat 4000 characters further down. `final_answer` holds the
    // closing block for those providers.
    const { container } = render(
      <TurnList
        turns={[
          makeTurn({
            agent_messages: [
              {
                text: "Looking at the interface now.",
                phase: null,
                timestamp: "",
                is_reasoning: false,
              },
              { text: "Let me read the parser.", phase: null, timestamp: "", is_reasoning: false },
              {
                text: "Here is the plan you asked for.",
                phase: null,
                timestamp: "",
                is_reasoning: false,
              },
            ],
            final_answer: "Here is the plan you asked for.",
          }),
        ]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    const preview = container.querySelector(".message--claude .message__content")!;
    expect(preview).toHaveTextContent("Here is the plan you asked for.");
    expect(preview).not.toHaveTextContent("Looking at the interface now.");
  });

  it("prefers an explicit final_answer phase over the closing prose", () => {
    // Codex marks the conclusion itself; a late commentary block must not win.
    const { container } = render(
      <TurnList
        turns={[
          makeTurn({
            agent_messages: [
              {
                text: "The marked answer.",
                phase: "final_answer",
                timestamp: "",
                is_reasoning: false,
              },
              {
                text: "A trailing commentary block.",
                phase: "commentary",
                timestamp: "",
                is_reasoning: false,
              },
            ],
            final_answer: "A trailing commentary block.",
          }),
        ]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    expect(container.querySelector(".message--claude .message__content")).toHaveTextContent(
      "The marked answer.",
    );
  });

  it("shows the full user message and the agent preview without any collapse affordance", () => {
    const onSelectTurn = vi.fn();
    const { container } = render(
      <TurnList turns={[makeTurn()]} selectedIndex={-1} onSelectTurn={onSelectTurn} />,
    );

    const userMessage = container.querySelector(".message--user .message__content")!;
    const codexMessage = container.querySelector(".message--claude .message__content")!;
    expect(userMessage).not.toHaveClass("message__content--collapsed");
    expect(codexMessage).not.toHaveClass("message__content--collapsed");

    // Clicking a message no longer folds it — it opens the turn detail.
    fireEvent.click(container.querySelector(".message--user")!);
    expect(onSelectTurn).toHaveBeenCalledWith(0);
    expect(userMessage).not.toHaveClass("message__content--collapsed");
  });

  it("renders message prose as markdown rather than raw text", () => {
    const { container } = render(
      <TurnList
        turns={[
          makeTurn({
            user_message: "# Heading\n\n- item one\n- item two",
            final_answer: "**bold** reply",
            agent_messages: [{ ...FINAL_MSG, text: "**bold** reply" }],
          }),
        ]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    const userContent = container.querySelector(".message--user .message__content")!;
    expect(userContent.querySelector("h1")).toHaveTextContent("Heading");
    expect(userContent.querySelectorAll("li")).toHaveLength(2);

    const agentContent = container.querySelector(".message--claude .message__content")!;
    expect(agentContent.querySelector("strong")).toHaveTextContent("bold");
    expect(agentContent.textContent).not.toContain("**");
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

  it("hides tool activity until its toggle is pressed", () => {
    render(
      <TurnList
        turns={[makeTurn({ tool_calls: [EXEC_TOOL] })]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    // Closed by default: the transcript shows prose, not mechanics.
    expect(screen.queryByText("Shell")).not.toBeInTheDocument();
    const toggle = screen.getByText("Show activity (1)");

    fireEvent.click(toggle);
    expect(screen.getByText("Shell")).toBeInTheDocument();
    expect(screen.getByText("ls")).toBeInTheDocument();
  });

  it("closes the activity timeline when its toggle is pressed again", () => {
    render(
      <TurnList
        turns={[makeTurn({ tool_calls: [EXEC_TOOL] })]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Show activity (1)"));
    expect(screen.getByText("Shell")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Hide activity (1)"));
    expect(screen.queryByText("Shell")).not.toBeInTheDocument();
  });

  it("brings the tool calls into view when the activity toggle opens them", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <TurnList
        turns={[makeTurn({ tool_calls: [EXEC_TOOL] })]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );
    scrollIntoView.mockClear();

    fireEvent.click(screen.getByText("Show activity (1)"));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("leaves the scroll alone when the activity toggle closes the timeline", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <TurnList
        turns={[makeTurn({ tool_calls: [EXEC_TOOL] })]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Show activity (1)"));
    scrollIntoView.mockClear();
    fireEvent.click(screen.getByText("Hide activity (1)"));
    // Closing must not scroll away from the message the toggle sits on.
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("counts every tool call in the activity toggle label", () => {
    const tool2 = { ...EXEC_TOOL, call_id: "c2" };
    render(
      <TurnList
        turns={[makeTurn({ tool_calls: [EXEC_TOOL, tool2] })]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Show activity (2)"));
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

  it("puts the reply timestamp before the header actions, with the seconds beside it", () => {
    const { container } = render(
      <TurnList
        turns={[makeTurn({ duration_ms: 3000 })]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    const header = container.querySelector(".message--claude .message__header")!;
    const timestamp = header.querySelector(".message__timestamp")!;
    const detail = header.querySelector(".message__detail-btn")!;

    // The time reads before the actions rather than being pushed to the far edge.
    expect(timestamp.compareDocumentPosition(detail)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(timestamp).toHaveTextContent(formatExactTime(new Date(1745661660 * 1000).toISOString()));
    expect(container.querySelector(".message__timestamp-duration")).toHaveTextContent("(3s)");
  });

  it("omits the execution seconds when the turn has no duration", () => {
    render(
      <TurnList
        turns={[makeTurn({ duration_ms: null, turn_tokens: null })]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );
    expect(document.querySelector(".message__timestamp-duration")).not.toBeInTheDocument();
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

    // The preview is markdown now, so the error style rides on the wrapper.
    expect(
      screen
        .getByText("exceeded retry limit, last status: 429 Too Many Requests")
        .closest(".message__content"),
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

  it("counts reasoning blocks in the activity toggle label", () => {
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

    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Show activity (1)"));
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

  it("groups the minimap ticks in a compact list wrapper", () => {
    const { container } = render(
      <TurnList
        turns={[
          makeTurn({ turn_id: "t1", user_message: "First question" }),
          makeTurn({ turn_id: "t2", user_message: "Second question" }),
        ]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    const list = container.querySelector(".turn-minimap__list");
    expect(list).toBeInTheDocument();
    expect(list?.querySelectorAll(".turn-minimap__tick")).toHaveLength(2);
  });

  it("drives the tick pitch from the tick count so few questions stay compact", () => {
    const two = render(
      <TurnList
        turns={[
          makeTurn({ turn_id: "t1", user_message: "Q1" }),
          makeTurn({ turn_id: "t2", user_message: "Q2" }),
        ]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );
    const smallPitch = two.container
      .querySelector<HTMLElement>(".turn-minimap")
      ?.style.getPropertyValue("--tick-pitch");
    expect(smallPitch).toBe(`${MAX_TICK_PITCH}px`);

    two.unmount();

    const many = render(
      <TurnList
        turns={Array.from({ length: 60 }, (_, i) =>
          makeTurn({ turn_id: `t${i}`, user_message: `Question ${i}` }),
        )}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );
    const densePitch = many.container
      .querySelector<HTMLElement>(".turn-minimap")
      ?.style.getPropertyValue("--tick-pitch");
    expect(parseFloat(densePitch!)).toBeLessThan(MAX_TICK_PITCH);
  });

  it("samples ticks on very long sessions instead of merging them into a bar", () => {
    // More questions than the rail can render at MIN_TICK_PITCH, so the rail
    // must sample rather than collapse the bars into a solid strip.
    const count = 200;
    const { container } = render(
      <TurnList
        turns={Array.from({ length: count }, (_, i) =>
          makeTurn({ turn_id: `t${i}`, user_message: `Question ${i}` }),
        )}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    const ticks = container.querySelectorAll(".turn-minimap__tick");
    expect(ticks.length).toBeGreaterThan(10);
    expect(ticks.length).toBeLessThan(count);
  });

  it("keeps the active question tick rendered on very long sessions", () => {
    const count = 200;
    // An index the even sampling skips, so it must be added explicitly.
    const active = 77;
    const turns = Array.from({ length: count }, (_, i) =>
      makeTurn({ turn_id: `t${i}`, user_message: `Question ${i}` }),
    );
    const { container } = render(
      <TurnList turns={turns} selectedIndex={active} onSelectTurn={vi.fn()} />,
    );

    // Guard the premise: this index really is skipped by plain sampling.
    const sampled = minimapLayout(count).indices;
    expect(sampled).not.toContain(active);

    const activeTicks = container.querySelectorAll(".turn-minimap__tick--active");
    expect(activeTicks).toHaveLength(1);
    expect(activeTicks[0]).toHaveAttribute(
      "aria-label",
      expect.stringContaining(`Question ${active}`),
    );
  });
});
