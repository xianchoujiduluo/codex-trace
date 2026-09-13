import { useState } from "react";
import type { CodexToolCall, CodexTurn } from "../../shared/types";
import { kindIcon } from "./ToolCallItem";

interface ActivityTimelineProps {
  turn: CodexTurn;
  /** Called when a tool line is clicked — opens the full turn detail. */
  onOpenDetail: () => void;
}

interface ToolActivity {
  type: "tool";
  order: number;
  tool: CodexToolCall;
}

interface ThinkingActivity {
  type: "thinking";
  order: number;
  text: string;
}

type ActivityItem = ToolActivity | ThinkingActivity;

const KIND_LABELS: Record<CodexToolCall["kind"], string> = {
  code_mode: "Code",
  exec_command: "Shell",
  mcp_tool: "MCP",
  patch_apply: "Patch",
  web_search: "Web",
  image_generation: "Image",
  spawn_agent: "Agent",
  wait_agent: "Wait",
  interrupt_agent: "Interrupt",
  followup_task: "Task",
  shell_hook: "Hook",
  context_query: "Context",
  agent_plugin: "Plugin",
  unknown: "Tool",
};

/** Friendly labels for well-known tools that arrive with the generic "unknown" kind
 * (chat providers like pi / Claude Code report file tools without a kind taxonomy). */
const NAME_LABELS: Record<string, string> = {
  read: "Read",
  edit: "Edit",
  write: "Write",
  multiedit: "Edit",
  notebookedit: "Edit",
  grep: "Search",
  glob: "Find",
  ls: "List",
  todowrite: "Todo",
  task: "Agent",
  bash: "Shell",
  webfetch: "Web",
  websearch: "Web",
  slashcommand: "Command",
};

function kindLabel(tool: CodexToolCall): string {
  const byKind = KIND_LABELS[tool.kind];
  if (tool.kind !== "unknown" && byKind) return byKind;
  return NAME_LABELS[tool.name.toLowerCase()] ?? "Tool";
}

/** First usable string field from a tool's structured arguments (path, query…). */
function argumentTarget(tool: CodexToolCall): string | null {
  const args = tool.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  for (const key of ["path", "file_path", "notebook_path", "url", "query", "pattern", "prompt"]) {
    const value = (args as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Short added/removed line counts across a patch tool's changed files. */
function patchStatLine(tool: CodexToolCall): string | null {
  if (!tool.patch_changes) return null;
  let added = 0;
  let removed = 0;
  for (const change of Object.values(tool.patch_changes)) {
    const diff = change.unified_diff;
    if (!diff) continue;
    for (const line of diff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) added++;
      else if (line.startsWith("-") && !line.startsWith("---")) removed++;
    }
  }
  return added + removed === 0 ? null : `+${added} −${removed}`;
}

/** One-line summary of what the tool targeted: command, file, server, query… */
function toolSummary(tool: CodexToolCall): string {
  if (tool.kind === "exec_command" && tool.command?.length) {
    return tool.command.join(" ");
  }
  if (tool.kind === "mcp_tool" && (tool.mcp_server || tool.mcp_tool)) {
    return [tool.mcp_server, tool.mcp_tool].filter(Boolean).join("::");
  }
  if (tool.kind === "web_search" && tool.web_query) return tool.web_query;
  if (tool.kind === "image_generation" && tool.image_prompt) return tool.image_prompt;
  if (tool.kind === "patch_apply" && tool.patch_changes) {
    return Object.keys(tool.patch_changes).join(", ");
  }
  const target = argumentTarget(tool);
  if (target) return target;
  if (tool.input_text) {
    const firstLine = tool.input_text.split("\n").find((line) => line.trim().length > 0);
    // Structured arguments rendered as text come out as raw JSON — skip to the name.
    if (firstLine && !firstLine.trimStart().startsWith("{")) return firstLine.trim();
  }
  return tool.name;
}

/**
 * Compact activity timeline under an assistant message, in the visual language
 * of a chat client: one muted line per tool call (icon, kind, target summary,
 * patch stats, failure state) and per reasoning block, in stream order.
 */
export function ActivityTimeline({ turn, onOpenDetail }: ActivityTimelineProps) {
  const [expandedThinking, setExpandedThinking] = useState<Set<number>>(new Set());

  const items: ActivityItem[] = [
    ...turn.tool_calls.map((tool, i): ToolActivity => ({
      type: "tool",
      order: turn.tool_call_orders?.[i] ?? Number.MAX_SAFE_INTEGER,
      tool,
    })),
    ...turn.agent_messages
      .filter((message) => message.is_reasoning && message.text.trim().length > 0)
      .map((message, i): ThinkingActivity => ({
        type: "thinking",
        order: message.order ?? Number.MAX_SAFE_INTEGER - 1 - i,
        text: message.text,
      })),
  ].toSorted((a, b) => a.order - b.order);

  if (items.length === 0) return null;

  const toggleThinking = (order: number) => {
    setExpandedThinking((prev) => {
      const next = new Set(prev);
      if (next.has(order)) next.delete(order);
      else next.add(order);
      return next;
    });
  };

  return (
    <div className="activity">
      {items.map((item, i) => {
        if (item.type === "thinking") {
          const expanded = expandedThinking.has(item.order);
          return (
            <div key={`thinking-${item.order}`} className="activity__item">
              <div
                className="activity-line activity-line--thinking"
                onClick={() => toggleThinking(item.order)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") toggleThinking(item.order);
                }}
              >
                <span className="activity-line__icon">{kindIcon("unknown", false)}</span>
                <span className="activity-line__label">Thinking</span>
                <span className="activity-line__hint">{expanded ? "hide" : "show"}</span>
              </div>
              {expanded && <pre className="activity-line__thinking-text">{item.text}</pre>}
            </div>
          );
        }

        const failed = item.tool.status === "failed";
        const stats = patchStatLine(item.tool);
        return (
          <div
            key={item.tool.call_id || `tool-${i}`}
            className="activity-line"
            onClick={onOpenDetail}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") onOpenDetail();
            }}
          >
            <span className="activity-line__icon">{kindIcon(item.tool.kind, failed)}</span>
            <span className="activity-line__label">{kindLabel(item.tool)}</span>
            <span className="activity-line__summary">{toolSummary(item.tool)}</span>
            {stats && (
              <span className="activity-line__diff">
                <span className="activity-line__diff-add">{stats.split(" ")[0]}</span>{" "}
                <span className="activity-line__diff-del">{stats.split(" ")[1]}</span>
              </span>
            )}
            {failed && <span className="activity-line__failed">failed</span>}
          </div>
        );
      })}
    </div>
  );
}
