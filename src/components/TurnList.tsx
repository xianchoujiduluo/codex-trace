import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import type { CodexTurn, SessionPagination } from "../../shared/types";
import { displayedTokenTotal, formatDuration, formatTokens } from "../../shared/format";
import { formatExactTime } from "../lib/format";
import { useAutoScroll } from "../hooks/useAutoScroll";
import { useActiveTurn } from "../hooks/useActiveTurn";
import { useScrollToSelected } from "../hooks/useScrollToSelected";
import { OngoingDots } from "./OngoingDots";
import { BackIcon, CodexIcon, ForwardIcon, TokensIcon, DurationIcon, ToolsIcon } from "./Icons";
import { tokenBreakdownTitle } from "./TokenBar";
import { SubagentMarker } from "./SubagentMarker";
import { ActivityTimeline, activityItems } from "./ActivityTimeline";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { matchesTurn } from "../lib/turnSearch";
import { minimapLayout } from "../lib/minimap";

/**
 * How close to the top of the transcript counts as "reaching for older turns".
 *
 * Same order as `useAutoScroll`'s near-bottom threshold, so the two ends of the
 * transcript feel alike.
 */
const LOAD_OLDER_THRESHOLD_PX = 150;

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

/**
 * Whole seconds a reply took, shown in parentheses beside its timestamp.
 *
 * Deliberately rawer than `formatDuration` ("1m 2s"), which still carries the
 * humanised value on the stats line below — this one answers "how many seconds
 * was that" at a glance.
 */
function executionSeconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

/**
 * The reply text the transcript shows under the header.
 *
 * A turn streams as many prose blocks between its tool calls, and a chat
 * transcript wants the conclusion, not the play-by-play — pi and Claude Code
 * turns routinely open with a sentence like "看懂了目标界面，现在让我研究代码"
 * and put the actual answer thousands of characters later. So: an explicit
 * `phase: "final_answer"` wins where the provider sets one (Codex), and
 * `turn.final_answer` covers the providers that do not — it holds the last
 * prose block of the turn, which is the closing message in every transcript
 * shape seen so far. The first non-reasoning block stays as the last resort for
 * a turn whose only prose is incomplete.
 */
function agentPreviewText(turn: CodexTurn): string | null {
  if (turn.error) return turn.error;
  const phased = turn.agent_messages.find((m) => m.phase === "final_answer");
  if (phased) return phased.text;
  if (turn.final_answer) return turn.final_answer;
  return turn.agent_messages.find((m) => !m.is_reasoning)?.text ?? null;
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
  // The rail marks where the reader actually is, which is a scroll position
  // rather than the selection: clicking a turn jumps to it, and jumping with
  // the rail itself must move the mark too.
  const activeTurnIndex = useActiveTurn(listRef, visibleTurns.length);
  // Tool calls and reasoning are the noisy part of a turn, so they start hidden
  // and each assistant message carries its own toggle for them.
  const [openActivity, setOpenActivity] = useState<Set<number>>(new Set());
  const previouslyOpenActivity = useRef<Set<number>>(new Set());

  const toggleActivity = useCallback((i: number) => {
    setOpenActivity((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  // A timeline is often taller than the viewport, so the tool calls it just
  // revealed can land entirely below the fold and the button reads as inert.
  // Jump the scroll container to the block that was opened — only on open, since
  // collapsing should not scroll away from the line the user just dismissed.
  // `useLayoutEffect` so the jump lands with the block rather than a frame later.
  useLayoutEffect(() => {
    const opened = [...openActivity].find((i) => !previouslyOpenActivity.current.has(i));
    previouslyOpenActivity.current = openActivity;
    if (opened === undefined) return;
    listRef.current
      ?.querySelector(`[data-turn-index="${opened}"] .activity`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [openActivity, listRef]);

  const scrollToTurn = (index: number) => {
    listRef.current
      ?.querySelector(`[data-turn-index="${index}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Reaching the top of the transcript pulls in the previous page; the button
  // stays for anyone who prefers it, and for a page short enough that no scroll
  // event ever fires.
  //
  // `armedRef` is what keeps this from running away, and it starts **disarmed**.
  // Scroll events also fire for the app's own programmatic scrolling — opening a
  // session scrolls the transcript down to the newest turn, and an armed trigger
  // would read that pass through the top as the reader asking for older turns,
  // loading a page before they had even seen the newest one. It arms only once
  // `scrollTop` has moved past `LOAD_OLDER_THRESHOLD_PX * 2`, so the reader must
  // genuinely be somewhere below the top. It then disarms as it fires, so a page
  // that does not fill the viewport cannot chain-load page after page until the
  // whole session is in memory — the exact thing paging exists to avoid. Every
  // automatic page costs one deliberate gesture.
  const armedRef = useRef(false);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (!onLoadMore || loadingMore) return;
    if (pagination?.direction !== "backward" || !pagination.has_more) return;

    const handleScroll = () => {
      if (el.scrollTop > LOAD_OLDER_THRESHOLD_PX * 2) {
        armedRef.current = true;
      } else if (el.scrollTop <= LOAD_OLDER_THRESHOLD_PX && armedRef.current) {
        armedRef.current = false;
        onLoadMore();
      }
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [listRef, onLoadMore, loadingMore, pagination?.direction, pagination?.has_more]);

  const questionTurns = useMemo(
    () => visibleTurns.filter(({ turn }) => (turn.user_message ?? "").trim().length > 0),
    [visibleTurns],
  );
  const hasMinimap = questionTurns.length > 0;

  // The rail height drives the tick pitch so long sessions compress to fit
  // instead of overflowing the viewport. Measured rather than assumed because
  // the transcript area changes with the window and the sidebar width.
  const minimapRef = useRef<HTMLElement>(null);
  const [minimapHeight, setMinimapHeight] = useState(0);

  useEffect(() => {
    const el = minimapRef.current;
    if (!el) return;
    const measure = () => setMinimapHeight(el.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMinimap]);

  // Which question the rail should mark. Every turn's index is absolute, while
  // the rail holds one tick per question, so the active turn maps to the last
  // question at or before it — the question whose answer the reader is inside.
  const railAnchorIndex = useMemo(() => {
    if (activeTurnIndex === null) return selectedIndex;
    let anchor: number | null = null;
    for (const { index } of questionTurns) {
      if (index <= activeTurnIndex) anchor = index;
      else break;
    }
    return anchor ?? questionTurns[0]?.index ?? selectedIndex;
  }, [activeTurnIndex, questionTurns, selectedIndex]);

  const layout = minimapLayout(
    questionTurns.length,
    minimapHeight || undefined,
    questionTurns.findIndex(({ index }) => index === railAnchorIndex),
  );
  const visibleTicks = layout.indices
    .map((i) => questionTurns[i])
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return (
    <div className="chat-view">
      {hasMinimap && (
        <nav
          ref={minimapRef}
          className="turn-minimap"
          aria-label="Question quick navigation"
          style={{ "--tick-pitch": `${layout.pitch}px` } as CSSProperties}
        >
          <div className="turn-minimap__list">
            {visibleTicks.map(({ turn, index: i }) => (
              <button
                key={turn.turn_id}
                type="button"
                className={`turn-minimap__tick${i === railAnchorIndex ? " turn-minimap__tick--active" : ""}`}
                aria-label={`Jump to question: ${(turn.user_message ?? "").slice(0, 60)}`}
                onClick={() => scrollToTurn(i)}
              >
                <span className="turn-minimap__bar" />
                <span className="turn-minimap__tooltip">{turn.user_message}</span>
              </button>
            ))}
          </div>
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
          const agentPreview = agentPreviewText(turn);
          const hasDetail = Boolean(
            turn.error || turn.agent_messages.length > 0 || turn.tool_calls.length > 0,
          );
          const activityCount = activityItems(turn).length;
          const activityOpen = openActivity.has(i);
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
                onClick={() => onSelectTurn(i)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelectTurn(i);
                }}
              >
                {userMsg && (
                  <div className="message__content">
                    <div className="markdown-body">
                      <MarkdownRenderer content={userMsg} breaks />
                    </div>
                  </div>
                )}
                {userTs && (
                  <span className="message__timestamp message__timestamp--user">{userTs}</span>
                )}
              </div>

              {/* Agent message — left, full-width plain content */}
              <div
                className={`message message--claude${isSelected ? " message--selected" : ""}`}
                onClick={() => onSelectTurn(i)}
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
                  {/* The reply time leads the header rather than trailing it, so
                     the eye picks it up before the action buttons. */}
                  {agentTs && (
                    <span className="message__timestamp">
                      {agentTs}
                      {turn.duration_ms !== null && (
                        <span className="message__timestamp-duration">
                          ({executionSeconds(turn.duration_ms)})
                        </span>
                      )}
                    </span>
                  )}
                  {activityCount > 0 && (
                    <button
                      type="button"
                      className={`message__activity-btn${activityOpen ? " message__activity-btn--open" : ""}`}
                      aria-expanded={activityOpen}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleActivity(i);
                      }}
                    >
                      <ToolsIcon />
                      {activityOpen ? "Hide" : "Show"} activity ({activityCount})
                    </button>
                  )}
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
                </div>

                {agentPreview && (
                  <div
                    className={`message__content${turn.error ? " message__content--error" : ""}`}
                  >
                    <div className="markdown-body">
                      <MarkdownRenderer content={agentPreview} breaks />
                    </div>
                  </div>
                )}

                {activityOpen && <ActivityTimeline turn={turn} />}

                {(turn.turn_tokens || turn.duration_ms !== null) && (
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
