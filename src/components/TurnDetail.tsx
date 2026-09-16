import type { AgentMessage, CodexToolCall, CodexTurn } from "../../shared/types";
import { RawExecDetails, ToolCallItem } from "./ToolCallItem";
import { ComplementaryItem } from "./ComplementaryItem";
import { OngoingDots } from "./OngoingDots";
import { BackIcon, CodexIcon, SpawnIcon, UserIcon } from "./Icons";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { CopyMessageButton } from "./CopyMessageButton";
import { workerPanelTitle } from "./WorkerPanel";
import { shortModel, formatExactTime } from "../lib/format";
import { getContextColor, getModelColor } from "../lib/theme";
import { contextRemainingPercent, formatTokens, formatDuration } from "../../shared/format";
import { TokenBar } from "./TokenBar";
import { matchesText, toolSearchText } from "../lib/turnSearch";

interface TurnDetailProps {
  turn: CodexTurn;
  expanded: Set<number>;
  onToggle: (i: number) => void;
  onBack: () => void;
  openWorkerCallId?: string | null;
  onOpenWorkerPanel?: (tool: CodexToolCall) => void;
  searchQuery?: string;
}

export function TurnDetail({
  turn,
  expanded,
  onToggle,
  onBack,
  openWorkerCallId,
  onOpenWorkerPanel,
  searchQuery = "",
}: TurnDetailProps) {
  const commentary = turn.agent_messages.filter(
    (m) => m.phase !== "final_answer" && !m.is_reasoning,
  );
  const reasoning = turn.agent_messages.filter((m) => m.is_reasoning);
  const finalAnswer = turn.agent_messages.find((m) => m.phase === "final_answer");
  const tokenSnapshot = turn.total_tokens;
  const turnTokens = turn.turn_tokens;

  // Interleave commentary messages with tool calls by their stream order, so each tool call
  // shows up inline where it actually happened instead of being dumped at the end of the turn.
  // When order data is missing (old cached sessions), messages keep order 0 and tools sort last,
  // which reproduces the previous "messages first, tools after" layout.
  type TimelineItem =
    | { order: number; kind: "msg"; msg: AgentMessage }
    | { order: number; kind: "tool"; tool: CodexToolCall; index: number }
    | { order: number; kind: "raw_exec"; tool: CodexToolCall };
  const timeline: TimelineItem[] = [];
  commentary.forEach((msg) => {
    timeline.push({ order: msg.order ?? 0, kind: "msg", msg });
  });
  const codeModeCalls = turn.tool_calls
    .map((tool, index) => ({ tool, index, order: turn.tool_call_orders?.[index] }))
    .filter(({ tool, order }) => tool.kind === "code_mode" && order !== undefined)
    .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const redundantCodeModeIndexes = new Set<number>();
  codeModeCalls.forEach(({ tool, index, order }, codeModeIndex) => {
    const nextOrder = codeModeCalls[codeModeIndex + 1]?.order ?? Number.MAX_SAFE_INTEGER;
    const nestedKinds = (tool.nested_tool_calls ?? []).map((call) => call.kind);
    if (
      nestedKinds.length === 0 ||
      nestedKinds.some((kind) => kind !== "exec_command" && kind !== "patch_apply")
    ) {
      return;
    }
    const structuredKinds = turn.tool_calls
      .map((candidate, candidateIndex) => ({
        candidate,
        candidateOrder: turn.tool_call_orders?.[candidateIndex] ?? Number.MAX_SAFE_INTEGER,
      }))
      .filter(
        ({ candidate, candidateOrder }) =>
          (candidate.name === "command_execution" || candidate.name === "file_change") &&
          candidateOrder > (order ?? Number.MAX_SAFE_INTEGER) &&
          candidateOrder < nextOrder,
      )
      .map(({ candidate }) => candidate.kind);
    const remaining = [...structuredKinds];
    const allRepresented = nestedKinds.every((kind) => {
      const match = remaining.indexOf(kind);
      if (match < 0) return false;
      remaining.splice(match, 1);
      return true;
    });
    if (allRepresented) redundantCodeModeIndexes.add(index);
  });

  turn.tool_calls.forEach((tool, index) => {
    const order = turn.tool_call_orders?.[index] ?? Number.MAX_SAFE_INTEGER;
    timeline.push(
      redundantCodeModeIndexes.has(index)
        ? { order, kind: "raw_exec", tool }
        : { order, kind: "tool", tool, index },
    );
  });
  timeline.sort((a, b) => a.order - b.order);
  const searchActive = searchQuery.trim().length > 0;
  const visibleTimeline = searchActive
    ? timeline.filter((item) =>
        item.kind === "msg"
          ? matchesText(item.msg.text, searchQuery)
          : matchesText(toolSearchText(item.tool), searchQuery),
      )
    : timeline;
  const visibleWarnings = searchActive
    ? (turn.warnings ?? []).filter((warning) => matchesText(warning, searchQuery))
    : (turn.warnings ?? []);
  const showError = Boolean(turn.error && (!searchActive || matchesText(turn.error, searchQuery)));
  const visibleFinalAnswer =
    finalAnswer && (!searchActive || matchesText(finalAnswer.text, searchQuery))
      ? finalAnswer
      : null;
  const showUserMessage = Boolean(
    searchActive && turn.user_message && matchesText(turn.user_message, searchQuery),
  );
  const hasSearchMatches =
    showUserMessage ||
    showError ||
    visibleWarnings.length > 0 ||
    visibleTimeline.length > 0 ||
    visibleFinalAnswer !== null;
  const model = turn.model ? shortModel(turn.model) : "";
  const modelColor = turn.model ? getModelColor(turn.model) : undefined;
  const linkedAgents = turn.tool_calls.filter(
    (tool) => tool.kind === "spawn_agent" && tool.worker_session,
  );

  const metaParts: string[] = [];
  if (turn.duration_ms) metaParts.push(formatDuration(turn.duration_ms));
  const contextLeftPercent = tokenSnapshot
    ? contextRemainingPercent(
        tokenSnapshot.context_window_tokens,
        tokenSnapshot.model_context_window,
      )
    : null;
  const contextUsedPercent = contextLeftPercent === null ? null : 100 - contextLeftPercent;
  const contextTitle =
    tokenSnapshot && tokenSnapshot.context_window_tokens !== null
      ? `${formatTokens(tokenSnapshot.context_window_tokens)} / ${formatTokens(
          tokenSnapshot.model_context_window,
        )} context tokens`
      : undefined;

  return (
    <div className="turn-detail">
      <div className="message-detail__header">
        <button className="message-detail__back" onClick={onBack}>
          <BackIcon /> Back
        </button>
        <span className="message-detail__role-icon">
          <CodexIcon />
        </span>
        <span className="message-detail__title">Codex</span>
        {model && <span style={{ color: modelColor, fontWeight: 600, fontSize: 12 }}>{model}</span>}
        {turn.status === "ongoing" && <OngoingDots count={3} />}
        {/* The prompt leads the whole view rather than sitting somewhere inside the
           timeline: everything below it — reasoning, tool calls, the final answer —
           only makes sense as a response to it, and scrolling back to find it means
           losing your place in the trace. Truncated to one line to keep the header
           from growing; the full text is the tooltip and the search-hit section. */}
        {turn.user_message && (
          <span className="message-detail__question" title={turn.user_message}>
            <span className="message-detail__question-icon">
              <UserIcon />
            </span>
            {turn.user_message.replace(/\s+/g, " ").trim()}
          </span>
        )}
        {(contextLeftPercent !== null || metaParts.length > 0) && (
          <div className="message-detail__meta">
            {contextLeftPercent !== null && contextUsedPercent !== null && (
              <div className="message-detail__context info-bar__context" title={contextTitle}>
                <span>ctx {contextLeftPercent}% left</span>
                <div className="info-bar__context-bar">
                  <div
                    className="info-bar__context-fill"
                    style={{
                      width: `${contextUsedPercent}%`,
                      backgroundColor: getContextColor(contextUsedPercent),
                    }}
                  />
                </div>
              </div>
            )}
            {metaParts.length > 0 && (
              <span className="message-detail__meta-text">{metaParts.join(" · ")}</span>
            )}
          </div>
        )}
      </div>

      <div className="turn-detail__body">
        <div className="turn-detail__content">
          {linkedAgents.length > 0 && (
            <div className="turn-detail__section turn-detail__section--agents">
              <div className="turn-detail__section-label">
                <SpawnIcon /> Agents ({linkedAgents.length})
              </div>
              <div className="turn-detail__agents">
                {linkedAgents.map((tool) => {
                  const worker = tool.worker_session!;
                  const label = workerPanelTitle(tool, worker);
                  const control = onOpenWorkerPanel ? (
                    <button
                      type="button"
                      className="turn-detail__agent"
                      onClick={() => onOpenWorkerPanel(tool)}
                      title={`Open ${label} execution details`}
                    >
                      <SpawnIcon />
                      <span>{label}</span>
                      <span className="turn-detail__agent-status">
                        {worker.is_ongoing ? "Active" : "Complete"}
                      </span>
                    </button>
                  ) : (
                    <span className="turn-detail__agent turn-detail__agent--static">
                      <SpawnIcon />
                      <span>{label}</span>
                      <span className="turn-detail__agent-status">
                        {worker.is_ongoing ? "Active" : "Complete"}
                      </span>
                    </span>
                  );
                  return <div key={tool.call_id}>{control}</div>;
                })}
              </div>
            </div>
          )}

          {turnTokens && (
            <div className="turn-detail__token-summary">
              <div className="turn-detail__section-label">This turn</div>
              <TokenBar tokens={turnTokens} />
            </div>
          )}

          {showUserMessage && (
            <div className="turn-detail__section turn-detail__section--search-match">
              <div className="turn-detail__section-label">User message</div>
              <pre className="turn-detail__search-text">{turn.user_message}</pre>
            </div>
          )}

          {showError && (
            <div className="turn-detail__section turn-detail__section--error">
              <div className="turn-detail__section-label">Error</div>
              <pre className="turn-detail__error">{turn.error}</pre>
            </div>
          )}

          {visibleWarnings.length > 0 && (
            <div className="turn-detail__section turn-detail__section--warning">
              <div className="turn-detail__section-label">Warnings</div>
              {visibleWarnings.map((warning) => (
                <pre key={warning} className="turn-detail__warning">
                  {warning}
                </pre>
              ))}
            </div>
          )}

          {!searchActive && reasoning.length > 0 && (
            <div className="turn-detail__section turn-detail__section--reasoning">
              <div
                className="turn-detail__section-label"
                style={{ color: "var(--reasoning-text)" }}
              >
                Reasoning
              </div>
              {reasoning.every((message) => !message.text.trim()) ? (
                <div className="turn-detail__reasoning-note">
                  (reasoning encrypted — cannot display)
                </div>
              ) : (
                <details className="turn-detail__reasoning">
                  <summary>
                    {reasoning.length} {reasoning.length === 1 ? "entry" : "entries"}
                  </summary>
                  {reasoning.map((message, i) =>
                    message.text.trim() ? (
                      // Reasoning entries can repeat verbatim (degenerate model loops), so
                      // content keys would collide; fall back to position for identity.
                      // oxlint-disable-next-line react/no-array-index-key
                      <pre key={`reasoning-${i}`} className="turn-detail__reasoning-entry">
                        {message.text}
                      </pre>
                    ) : null,
                  )}
                </details>
              )}
            </div>
          )}

          {visibleTimeline.length > 0 && (
            <div className="turn-detail__section turn-detail__section--activity">
              {visibleTimeline.map((item, i) =>
                item.kind === "msg" ? (
                  <ComplementaryItem key={`m-${item.msg.timestamp || i}`} msg={item.msg} />
                ) : item.kind === "raw_exec" ? (
                  <RawExecDetails key={`raw-${item.tool.call_id || i}`} tool={item.tool} />
                ) : (
                  <ToolCallItem
                    key={`t-${item.tool.call_id || item.index}`}
                    tool={item.tool}
                    expanded={expanded.has(item.index)}
                    onToggle={() => onToggle(item.index)}
                    isWorkerOpen={item.tool.call_id === openWorkerCallId}
                    onOpenWorker={onOpenWorkerPanel}
                  />
                ),
              )}
            </div>
          )}

          {visibleFinalAnswer && (
            <div className="turn-detail__section turn-detail__section--final">
              <div className="turn-detail__section-label">Final answer</div>
              <div className="turn-detail__msg">
                <div className="turn-detail__msg-header">
                  <CopyMessageButton text={visibleFinalAnswer.text} label="Final answer content" />
                  {visibleFinalAnswer.timestamp && (
                    <span className="turn-detail__msg-time">
                      {formatExactTime(visibleFinalAnswer.timestamp)}
                    </span>
                  )}
                </div>
                <div className="markdown-body">
                  <MarkdownRenderer content={visibleFinalAnswer.text} />
                </div>
              </div>
            </div>
          )}

          {searchActive && !hasSearchMatches && (
            <div className="turn-detail__search-empty">No matches in this turn.</div>
          )}

          {turn.has_compaction && (
            <div className="turn-detail__compaction-note">Context was compacted in this turn.</div>
          )}
        </div>
      </div>
    </div>
  );
}
