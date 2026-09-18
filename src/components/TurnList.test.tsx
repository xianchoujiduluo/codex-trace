import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type {
  AgentMessage,
  CodexToolCall,
  CodexTurn,
  SessionPagination,
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

/** A backward-paged session: older turns are still on the server. */
const BACKWARD_PAGE: SessionPagination = {
  direction: "backward",
  next_cursor: 1,
  has_more: true,
  total_turns: 4,
  source_size_bytes: 20_000_000,
  page_bytes: 10_000_000,
};

/**
 * Drive the transcript's scroll listener. jsdom leaves `scrollTop` at 0 always,
 * so the position is stubbed and the existing `scroll` event dispatched — which
 * is exactly what the component listens for.
 */
function scrollMessageList(container: HTMLElement, scrollTop: number) {
  const list = container.querySelector<HTMLElement>(".message-list")!;
  Object.defineProperty(list, "scrollTop", { value: scrollTop, configurable: true });
  fireEvent.scroll(list);
}

/** Index of the rail tick currently marked active, or -1 when none is. */
function activeTickIndex(): number {
  const ticks = screen.getAllByRole("button", { name: /Jump to question/ });
  return ticks.findIndex((tick) => tick.classList.contains("turn-minimap__tick--active"));
}

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

  it("shows every prose block of a reply, not just the closing one", () => {
    // Chat providers stream prose between tool calls. The transcript used to
    // render only the last block, so a turn whose answer was preceded by a dozen
    // findings looked like it had dropped the reply while the detail view had it
    // all. Every block is rendered now, in stream order.
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
    expect(preview).toHaveTextContent("Looking at the interface now.");
    expect(preview).toHaveTextContent("Let me read the parser.");
    expect(preview).toHaveTextContent("Here is the plan you asked for.");
  });

  it("keeps a short reply unfolded", () => {
    const { container } = render(
      <TurnList turns={[makeTurn()]} selectedIndex={-1} onSelectTurn={vi.fn()} />,
    );

    const content = container.querySelector(".message--claude .message__content")!;
    expect(content).not.toHaveClass("message__content--folded");
    expect(container.querySelector(".message__fold-btn")).not.toBeInTheDocument();
  });

  it("folds a long reply and unfolds it in place", () => {
    // 32 blocks / 2.7k characters was the reported turn; printing that inline
    // buries every turn after it.
    const blocks = Array.from({ length: 6 }, (_, n) => ({
      text: `Step ${n}: ${"detail ".repeat(40)}`,
      phase: null,
      timestamp: "",
      is_reasoning: false,
    }));
    const { container } = render(
      <TurnList
        turns={[makeTurn({ agent_messages: blocks, final_answer: blocks.at(-1)!.text })]}
        selectedIndex={-1}
        onSelectTurn={vi.fn()}
      />,
    );

    const content = container.querySelector(".message--claude .message__content")!;
    expect(content).toHaveClass("message__content--folded");

    const foldBtn = container.querySelector(".message__fold-btn")!;
    expect(foldBtn).toHaveTextContent("Show full reply (6 parts)");

    // The fold must not navigate away from the transcript.
    const onSelectTurn = vi.fn();
    fireEvent.click(foldBtn);
    expect(onSelectTurn).not.toHaveBeenCalled();

    const unfolded = container.querySelector(".message--claude .message__content")!;
    expect(unfolded).not.toHaveClass("message__content--folded");
    expect(container.querySelector(".message__fold-btn")).toHaveTextContent("Show less");
  });

  it("renders prose in stream order regardless of a provider's phase labels", () => {
    // Codex labels blocks `commentary` / `final_answer`. Order comes from the
    // stream, not the label: a reply reads as findings -> answer, and a late
    // commentary block belongs after the marked one, not instead of it.
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

    const content = container.querySelector(".message--claude .message__content")!;
    const text = content.textContent ?? "";
    expect(text).toContain("The marked answer.");
    expect(text).toContain("A trailing commentary block.");
    expect(text.indexOf("The marked answer.")).toBeLessThan(
      text.indexOf("A trailing commentary block."),
    );
    // Reasoning is thinking, not prose: it stays out of the reply.
    expect(container.querySelector(".message--claude .message__content")).not.toHaveTextContent(
      "internal reasoning",
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

    // Clicking a message only selects the turn; it must not open the detail page.
    fireEvent.click(container.querySelector(".message--user")!);
    expect(onSelectTurn).toHaveBeenCalledWith(0);
    expect(userMessage).not.toHaveClass("message__content--collapsed");
  });

  it("selects a turn on click without opening its detail page", () => {
    // The transcript is for reading. Every click inside a reply used to jump to
    // the detail page, so a reader could not select or copy anything in place.
    const onSelectTurn = vi.fn();
    const onOpenDetail = vi.fn();
    const { container } = render(
      <TurnList
        turns={[makeTurn()]}
        selectedIndex={-1}
        onSelectTurn={onSelectTurn}
        onOpenDetail={onOpenDetail}
      />,
    );

    // The user bubble and the whole reply body are both selection targets.
    fireEvent.click(container.querySelector(".message--user")!);
    fireEvent.click(container.querySelector(".message--claude")!);
    expect(onSelectTurn).toHaveBeenCalledTimes(2);
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("opens the detail page only from the Detail button", () => {
    const onSelectTurn = vi.fn();
    const onOpenDetail = vi.fn();
    render(
      <TurnList
        turns={[makeTurn()]}
        selectedIndex={-1}
        onSelectTurn={onSelectTurn}
        onOpenDetail={onOpenDetail}
      />,
    );

    fireEvent.click(document.querySelector(".message__detail-btn")!);
    expect(onOpenDetail).toHaveBeenCalledWith(0);
    // The button must not also fire the selection handler, or the highlight and
    // the opened turn could disagree.
    expect(onSelectTurn).not.toHaveBeenCalled();
  });

  it("keeps opening the detail page for callers with only one handler", () => {
    // `onOpenDetail` is optional; a caller that passes only `onSelectTurn` keeps
    // the old wiring.
    const onSelectTurn = vi.fn();
    render(<TurnList turns={[makeTurn()]} selectedIndex={-1} onSelectTurn={onSelectTurn} />);

    fireEvent.click(document.querySelector(".message__detail-btn")!);
    expect(onSelectTurn).toHaveBeenCalledWith(0);
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
        pagination={BACKWARD_PAGE}
        onLoadMore={onLoadMore}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Load older turns/ }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("loads the previous page when the transcript is scrolled to the top", () => {
    const onLoadMore = vi.fn();
    const { container } = render(
      <TurnList
        turns={[makeTurn()]}
        selectedIndex={0}
        onSelectTurn={vi.fn()}
        pagination={BACKWARD_PAGE}
        onLoadMore={onLoadMore}
      />,
    );

    // The trigger starts disarmed, so merely being at the top is not a request:
    // opening a session scrolls through the top, and that must not load a page.
    scrollMessageList(container, 0);
    expect(onLoadMore).not.toHaveBeenCalled();

    // A reader who moves down and then comes back to the top asks for older turns.
    scrollMessageList(container, 900);
    scrollMessageList(container, 0);
    expect(onLoadMore).toHaveBeenCalledOnce();

    // Sitting at the top keeps firing scroll events; only the first should load.
    scrollMessageList(container, 0);
    scrollMessageList(container, 40);
    expect(onLoadMore).toHaveBeenCalledOnce();

    // Moving down and back re-arms it for the next page.
    scrollMessageList(container, 900);
    scrollMessageList(container, 0);
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("does not pull older turns while a page is already loading", () => {
    const onLoadMore = vi.fn();
    const { container } = render(
      <TurnList
        turns={[makeTurn()]}
        selectedIndex={0}
        onSelectTurn={vi.fn()}
        pagination={BACKWARD_PAGE}
        onLoadMore={onLoadMore}
        loadingMore
      />,
    );

    scrollMessageList(container, 0);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("does not pull older turns once the first page is exhausted", () => {
    const onLoadMore = vi.fn();
    const { container } = render(
      <TurnList
        turns={[makeTurn()]}
        selectedIndex={0}
        onSelectTurn={vi.fn()}
        pagination={{ ...BACKWARD_PAGE, has_more: false, next_cursor: null, direction: "forward" }}
        onLoadMore={onLoadMore}
      />,
    );

    scrollMessageList(container, 0);
    expect(onLoadMore).not.toHaveBeenCalled();
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

  it("moves the active question tick to follow the transcript scroll", async () => {
    // The rail marks where the reader is, not where they last clicked: scrolling
    // to a different turn must move the mark, which is what the reader reported
    // missing when they scrolled or jumped with the rail itself.
    const { container } = render(
      <TurnList
        turns={[
          makeTurn({ turn_id: "t1", user_message: "First question" }),
          makeTurn({ turn_id: "t2", user_message: "Second question" }),
          makeTurn({ turn_id: "t3", user_message: "Third question" }),
        ]}
        selectedIndex={0}
        onSelectTurn={vi.fn()}
      />,
    );

    const list = container.querySelector<HTMLElement>(".message-list")!;
    // jsdom reports every rect as zero, so give the container a viewport and
    // give each turn a position; the hook reads exactly these values. The
    // container must be scrollable (scrollHeight > clientHeight) or the hook
    // treats it as already at the bottom.
    Object.defineProperty(list, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(list, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(list, "getBoundingClientRect", {
      value: () => ({ top: 0, bottom: 400, left: 0, right: 800, width: 800, height: 400 }),
      configurable: true,
    });
    Object.defineProperty(list, "scrollTop", { value: 500, configurable: true });
    // Turns are laid out top-to-bottom, so the tops must ascend in document
    // order; the hook walks them and keeps the last one at or above the edge.
    const tops = [0, 200, 400];
    container.querySelectorAll<HTMLElement>("[data-turn-index]").forEach((turn, i) => {
      Object.defineProperty(turn, "getBoundingClientRect", {
        value: () => ({
          top: tops[i],
          bottom: tops[i] + 200,
          left: 0,
          right: 800,
          width: 800,
          height: 200,
        }),
        configurable: true,
      });
    });

    // Scroll until the second turn sits at the top edge.
    tops[0] = -400;
    tops[1] = -20;
    tops[2] = 180;
    fireEvent.scroll(list);

    // The hook measures inside requestAnimationFrame to coalesce scroll events.
    await waitFor(() => expect(activeTickIndex()).toBe(1));
  });

  it("marks the first question while a short transcript is not scrolled", async () => {
    // When every turn already fits there is no "bottom" to be at. Treating
    // `scrollHeight === clientHeight` as the bottom marked the *last* turn on a
    // transcript the reader had not scrolled at all.
    //
    // The initial selection is deliberately NOT the expected answer: if the
    // measurement never ran, the highlight would simply stay on the selection
    // and the assertion would pass without testing anything.
    const { container } = render(
      <TurnList
        turns={[
          makeTurn({ turn_id: "t1", user_message: "First question" }),
          makeTurn({ turn_id: "t2", user_message: "Second question" }),
          makeTurn({ turn_id: "t3", user_message: "Third question" }),
        ]}
        selectedIndex={2}
        onSelectTurn={vi.fn()}
      />,
    );

    const list = container.querySelector<HTMLElement>(".message-list")!;
    // Fits without scrolling: equal heights, nothing scrolled. Read through
    // getters so the values survive whatever jsdom does to the element later.
    Object.defineProperty(list, "clientHeight", { get: () => 400, configurable: true });
    Object.defineProperty(list, "scrollHeight", { get: () => 400, configurable: true });
    Object.defineProperty(list, "scrollTop", { get: () => 0, configurable: true });
    Object.defineProperty(list, "getBoundingClientRect", {
      value: () => ({ top: 0, bottom: 400, left: 0, right: 800, width: 800, height: 400 }),
      configurable: true,
    });
    // Every turn sits just below the top edge, which is the state a transcript
    // that fits is in: the "nearest the top" rule finds nothing and falls back
    // to the first turn. Without the scrollable guard the at-bottom rule fires
    // instead (equal heights) and hands the mark to the *last* turn.
    const tops = [10, 160, 310];
    container.querySelectorAll<HTMLElement>("[data-turn-index]").forEach((turn, i) => {
      Object.defineProperty(turn, "getBoundingClientRect", {
        value: () => ({
          top: tops[i],
          bottom: tops[i] + 150,
          left: 0,
          right: 800,
          width: 800,
          height: 150,
        }),
        configurable: true,
      });
    });

    fireEvent.scroll(list);
    await waitFor(() => expect(activeTickIndex()).toBe(0));
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
