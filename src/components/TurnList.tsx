import { useState, useCallback, useMemo, useRef } from "react";
import type { CodexTurn, SessionPagination } from "../../shared/types";
import { displayedTokenTotal, formatDuration, formatTokens } from "../../shared/format";
import { formatExactTime } from "../lib/format";
import { useAutoScroll } from "../hooks/useAutoScroll";
import { useScrollToSelected } from "../hooks/useScrollToSelected";
import { OngoingDots } from "./OngoingDots";
import {
  BackIcon,
  CodexIcon,
  ForwardIcon,
  TokensIcon,
  ToolsIcon,
  DurationIcon,
  ThinkingIcon,
} from "./Icons";
import { tokenBreakdownTitle } from "./TokenBar";
import { SubagentMarker } from "./SubagentMarker";
import { matchesTurn } from "../lib/turnSearch";

interface TurnListProps {
  turns: CodexTurn[];
  selectedIndex: number;
  onSelectTurn: (index: number) => void;
  pagination?: SessionPagination | null;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  searchQuery?: string;
  /** Agent name shown on assistant messages, e.g. "Codex" | "Claude" | "pi". */
  providerName?: string;
}

function statusIcon(status: CodexTurn["status"]): string {
  if (status === "complete") return "✓";
  if (status === "aborted") return "✗";
  if (status === "cancelled") return "⊘";
  return "!";
}

export function TurnList({
  turns,
  selectedIndex,
  onSelectTurn,
  pagination,
  loadingMore = false,
  onLoadMore,
  searchQuery = "",
  providerName = "Codex",
}: TurnListProps) {
  const visibleTurns = useMemo(
    () =>
      turns
        .map((turn, index) => ({ turn, index }))
        .filter(({ turn }) => matchesTurn(turn, searchQuery)),
    [searchQuery, turns],
  );
  const listRef = useAutoScroll<HTMLDivElement>(visibleTurns.length);
  const selectedRef = useScrollToSelected(selectedIndex);
  const [collapsedUsers, setCollapsedUsers] = useState<Set<number>>(new Set());
  const [expandedCodex, setExpandedCodex] = useState<Set<number>>(new Set());
  const clickTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const toggleUser = useCallback((i: number) => {
    setCollapsedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const toggleCodex = useCallback((i: number) => {
    setExpandedCodex((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const handleCodexClick = useCallback(
    (i: number) => {
      if (clickTimers.current.has(i)) {
        clearTimeout(clickTimers.current.get(i)!);
        clickTimers.current.delete(i);
        onSelectTurn(i);
      } else {
        clickTimers.current.set(
          i,
          setTimeout(() => {
            clickTimers.current.delete(i);
            toggleCodex(i);
          }, 250),
        );
      }
    },
    [onSelectTurn, toggleCodex],
  );

  const scrollToTurn = (index: number) => {
    listRef.current
      ?.querySelector(`[data-turn-index="${index}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const questionTurns = useMemo(
    () => visibleTurns.filter(({ turn }) => (turn.user_message ?? "").trim().length > 0),
    [visibleTurns],
  );

  return (
    <div className="chat-view">
      {questionTurns.length > 0 && (
        <nav className="turn-minimap" aria-label="Question quick navigation">
          {questionTurns.map(({ turn, index: i }) => (
            <button
              key={turn.turn_id}
              type="button"
              className={`turn-minimap__tick${i === selectedIndex ? " turn-minimap__tick--active" : ""}`}
              aria-label={`Jump to question: ${(turn.user_message ?? "").slice(0, 60)}`}
              onClick={() => scrollToTurn(i)}
            >
              <span className="turn-minimap__bar" />
              <span className="turn-minimap__tooltip">{turn.user_message}</span>
            </button>
          ))}
        </nav>
      )}
      <div ref={listRef} className="message-list">
        {pagination?.has_more && pagination.direction === "backward" && onLoadMore && (
          <button
            type="button"
            className="message-list__load-more"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            <BackIcon /> {loadingMore ? "Loading older turns…" : "Load older turns"}
          </button>
        )}
        {visibleTurns.map(({ turn, index: i }) => {
          const isSelected = i === selectedIndex;
          const userMsg = turn.user_message ?? "";
          const userCollapsed = collapsedUsers.has(i);
          const agentPreview =
            turn.error ??
            turn.agent_messages.find((m) => m.phase === "final_answer")?.text ??
            turn.agent_messages.find((m) => !m.is_reasoning)?.text ??
            null;
          const hasDetail = Boolean(
            turn.error || turn.agent_messages.length > 0 || turn.tool_calls.length > 0,
          );
          const reasoningCount = turn.agent_messages.filter((m) => m.is_reasoning).length;
          const subagentCount = turn.collab_spawns.length;
          const usesSubagents = turn.tool_calls.some((tool) =>
            ["spawn_agent", "wait_agent", "interrupt_agent", "followup_task"].includes(tool.kind),
          );
          const hasSubagents = subagentCount > 0 || usesSubagents;
          const userTs = turn.started_at
            ? formatExactTime(new Date(turn.started_at * 1000).toISOString())
            : null;
          const agentTs = turn.completed_at
            ? formatExactTime(new Date(turn.completed_at * 1000).toISOString())
            : turn.agent_messages.at(-1)?.timestamp
              ? formatExactTime(turn.agent_messages.at(-1)!.timestamp)
              : null;

          return (
            <div
              key={turn.turn_id}
              ref={isSelected ? selectedRef : undefined}
              className={`turn-list__turn${hasSubagents ? " turn-list__turn--subagent" : ""}`}
              data-turn-index={i}
            >
              {/* User message — right-aligned bubble */}
              <div
                className={`message message--user${isSelected ? " message--selected" : ""}`}
                onClick={() => toggleUser(i)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") toggleUser(i);
                }}
              >
                {userMsg && (
                  <div
                    className={`message__content${userCollapsed ? " message__content--collapsed" : ""}`}
                  >
                    {userMsg}
                  </div>
                )}
                {userTs && (
                  <span className="message__timestamp message__timestamp--user">{userTs}</span>
                )}
              </div>

              {/* Agent message — left, full-width plain content */}
              <div
                className={`message message--claude${isSelected ? " message--selected" : ""}`}
                onClick={() => handleCodexClick(i)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelectTurn(i);
                }}
              >
                <div className="message__header">
                  {providerName === "Codex" ? (
                    <span className="message__role-icon">
                      <CodexIcon />
                    </span>
                  ) : (
                    <span className="message__role-icon message__role-icon--dot" />
                  )}
                  <span className="message__role message__role--claude">{providerName}</span>
                  <SubagentMarker count={subagentCount} active={usesSubagents} />
                  {turn.status === "ongoing" && <OngoingDots />}
                  {hasDetail && (
                    <button
                      className="message__detail-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTurn(i);
                      }}
                    >
                      Detail <ForwardIcon />
                    </button>
                  )}
                  {agentTs && <span className="message__timestamp">{agentTs}</span>}
                </div>

                {agentPreview && (
                  <div
                    className={`message__content${turn.error ? " message__content--error" : ""}${!expandedCodex.has(i) ? " message__content--collapsed" : ""}`}
                  >
                    {agentPreview}
                  </div>
                )}

                {(turn.turn_tokens || turn.tool_calls.length > 0 || turn.duration_ms !== null) && (
                  <div className="message__stats">
                    {turn.status !== "ongoing" && (
                      <span className={`message__stat turn-list__status--${turn.status}`}>
                        {statusIcon(turn.status)}
                      </span>
                    )}
                    {(turn.turn_tokens?.total_tokens ?? 0) > 0 && (
                      <span
                        className="message__stat message__stat--tokens"
                        title={tokenBreakdownTitle(turn.turn_tokens!)}
                      >
                        <span className="message__stat-icon">
                          <TokensIcon />
                        </span>
                        {formatTokens(
                          displayedTokenTotal(
                            turn.turn_tokens!.input_tokens,
                            turn.turn_tokens!.cached_input_tokens,
                            turn.turn_tokens!.output_tokens,
                          ),
                        )}{" "}
                        tok
                      </span>
                    )}
                    {turn.tool_calls.length > 0 && (
                      <span className="message__stat">
                        <span className="message__stat-icon">
                          <ToolsIcon />
                        </span>
                        {turn.tool_calls.length} tool{turn.tool_calls.length > 1 ? "s" : ""}
                      </span>
                    )}
                    {reasoningCount > 0 && (
                      <span className="message__stat">
                        <span className="message__stat-icon">
                          <ThinkingIcon />
                        </span>
                        {reasoningCount} think
                      </span>
                    )}
                    {turn.duration_ms !== null && (
                      <span className="message__stat">
                        <span className="message__stat-icon">
                          <DurationIcon />
                        </span>
                        {formatDuration(turn.duration_ms)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {visibleTurns.length === 0 && (
          <div className="message-list__empty">
            {searchQuery.trim()
              ? "No matching turns in this session."
              : "No turns in this session."}
          </div>
        )}
        {pagination?.has_more && pagination.direction === "forward" && onLoadMore && (
          <button
            type="button"
            className="message-list__load-more"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading newer turns…" : "Load newer turns"} <ForwardIcon />
          </button>
        )}
      </div>
    </div>
  );
}
