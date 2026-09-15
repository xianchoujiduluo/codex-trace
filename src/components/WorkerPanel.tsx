import { useCallback, useState } from "react";
import type { CSSProperties } from "react";
import type { CodexSession, CodexToolCall } from "../../shared/types";
import { formatDuration, shortPath } from "../../shared/format";
import { formatExactTime } from "../lib/format";
import { CloseIcon, SpawnIcon } from "./Icons";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { OngoingDots } from "./OngoingDots";
import { ToolCallItem } from "./ToolCallItem";

interface WorkerPanelProps {
  session: CodexSession;
  sourceTool: CodexToolCall;
  activeWorkerCallId?: string | null;
  style?: CSSProperties;
  onClose: () => void;
  onOpenWorker?: (tool: CodexToolCall) => void;
}

function stringArg(tool: CodexToolCall, key: string): string | null {
  const value = tool.arguments[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function spawnOutputString(tool: CodexToolCall, key: string): string | null {
  if (!tool.output) return null;
  try {
    const parsed = JSON.parse(tool.output) as Record<string, unknown>;
    const value = parsed[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function shortSessionId(session: CodexSession): string {
  return session.id ? session.id.slice(0, 8) : "unknown";
}

export function workerPanelTitle(sourceTool: CodexToolCall, session: CodexSession): string {
  const nickname = spawnOutputString(sourceTool, "nickname");
  const role = stringArg(sourceTool, "agent_type") ?? "worker";
  const shortId = shortSessionId(session);

  if (nickname) return `${nickname} (${shortId})`;
  return `${role} ${shortId}`;
}

function workerPanelDescription(sourceTool: CodexToolCall, session: CodexSession): string {
  const prompt = stringArg(sourceTool, "message");
  if (prompt) return prompt.split("\n")[0] ?? prompt;
  if (session.cwd) return shortPath(session.cwd);
  return "";
}

export function WorkerPanel({
  session,
  sourceTool,
  activeWorkerCallId,
  style,
  onClose,
  onOpenWorker,
}: WorkerPanelProps) {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const title = workerPanelTitle(sourceTool, session);
  const description = workerPanelDescription(sourceTool, session);

  const toggleTool = useCallback((key: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <div className="agent-panel codex-worker-panel" style={style}>
      <div className="agent-panel__header">
        <button className="agent-panel__close" onClick={onClose} title="Close worker panel">
          <CloseIcon />
        </button>
        <span className="agent-panel__icon">
          <SpawnIcon />
        </span>
        <span className="agent-panel__type">{title}</span>
        {description && <span className="agent-panel__desc">{description}</span>}
        {session.is_ongoing && <OngoingDots count={3} />}
        {sourceTool.duration_secs !== null && (
          <span className="agent-panel__stats">
            {formatDuration(sourceTool.duration_secs * 1000)}
          </span>
        )}
      </div>

      <div className="agent-panel__content">
        <div className="codex-worker-panel__list">
          {session.turns.map((turn, turnIndex) => {
            const commentary = turn.agent_messages.filter(
              (message) => message.phase !== "final_answer" && !message.is_reasoning,
            );
            const finalAnswer = turn.agent_messages.find(
              (message) => message.phase === "final_answer",
            );
            const turnKey = turn.turn_id || `${session.id}:${turnIndex}`;

            return (
              <div key={turnKey} className="codex-worker-panel__turn">
                {session.turns.length > 1 && (
                  <div className="codex-worker-panel__turn-label">Turn {turnIndex + 1}</div>
                )}

                {turn.user_message && (
                  <div className="codex-worker-panel__message">
                    <div className="codex-worker-panel__label">User</div>
                    <div className="markdown-body">
                      <MarkdownRenderer content={turn.user_message} />
                    </div>
                  </div>
                )}

                {commentary.map((message, messageIndex) => (
                  <div
                    key={message.timestamp ?? `${turnKey}:commentary:${messageIndex}`}
                    className="codex-worker-panel__message"
                  >
                    {message.timestamp && (
                      <div className="turn-detail__msg-header">
                        <span className="turn-detail__msg-time">
                          {formatExactTime(message.timestamp)}
                        </span>
                      </div>
                    )}
                    <div className="markdown-body">
                      <MarkdownRenderer content={message.text} />
                    </div>
                  </div>
                ))}

                {finalAnswer && (
                  <div className="codex-worker-panel__message">
                    <div className="codex-worker-panel__label">Final answer</div>
                    {finalAnswer.timestamp && (
                      <div className="turn-detail__msg-header">
                        <span className="turn-detail__msg-time">
                          {formatExactTime(finalAnswer.timestamp)}
                        </span>
                      </div>
                    )}
                    <div className="markdown-body">
                      <MarkdownRenderer content={finalAnswer.text} />
                    </div>
                  </div>
                )}

                {turn.tool_calls.length > 0 && (
                  <div className="codex-worker-panel__tools">
                    <div className="codex-worker-panel__label">
                      Tool calls ({turn.tool_calls.length})
                    </div>
                    {turn.tool_calls.map((tool, toolIndex) => {
                      const key = `${turnKey}:${tool.call_id || toolIndex}`;
                      return (
                        <ToolCallItem
                          key={key}
                          tool={tool}
                          expanded={expandedTools.has(key)}
                          onToggle={() => toggleTool(key)}
                          isWorkerOpen={tool.call_id === activeWorkerCallId}
                          onOpenWorker={onOpenWorker}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
