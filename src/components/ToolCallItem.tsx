import { useCallback, useMemo, useState } from "react";
import type { CodexToolCall, NestedToolCall } from "../../shared/types";
import { formatDuration } from "../../shared/format";
import type { DiffLine } from "../../shared/diff";
import { parseApplyPatch, parseUnifiedDiff, type PatchFile } from "../../shared/patch";
import { formatJson } from "../lib/format";
import {
  ExecIcon,
  McpIcon,
  PatchIcon,
  WebIcon,
  ImageIcon,
  SpawnIcon,
  WaitIcon,
  CloseAgentIcon,
  FollowupTaskIcon,
  HookIcon,
  UnknownToolIcon,
  WarningIcon,
  PopoutIcon,
} from "./Icons";
import { PopoutModal } from "./PopoutModal";

interface ToolCallItemProps {
  tool: CodexToolCall;
  expanded: boolean;
  onToggle: () => void;
  isWorkerOpen?: boolean;
  onOpenWorker?: (tool: CodexToolCall) => void;
}

export function kindIcon(kind: CodexToolCall["kind"], failed: boolean) {
  if (failed) return <WarningIcon />;
  switch (kind) {
    case "code_mode":
    case "exec_command":
      return <ExecIcon />;
    case "mcp_tool":
      return <McpIcon />;
    case "patch_apply":
      return <PatchIcon />;
    case "web_search":
      return <WebIcon />;
    case "image_generation":
      return <ImageIcon />;
    case "spawn_agent":
      return <SpawnIcon />;
    case "wait_agent":
      return <WaitIcon />;
    case "interrupt_agent":
      return <CloseAgentIcon />;
    case "followup_task":
      return <FollowupTaskIcon />;
    case "shell_hook":
      return <HookIcon />;
    case "context_query":
    case "agent_plugin":
    default:
      return <UnknownToolIcon />;
  }
}

function kindClass(kind: CodexToolCall["kind"]): string {
  switch (kind) {
    case "code_mode":
    case "exec_command":
      return "tool-call--exec";
    case "mcp_tool":
      return "tool-call--mcp";
    case "patch_apply":
      return "tool-call--patch";
    case "web_search":
      return "tool-call--web";
    case "image_generation":
      return "tool-call--image";
    case "spawn_agent":
    case "wait_agent":
    case "interrupt_agent":
    case "followup_task":
      return "tool-call--collab";
    case "shell_hook":
      return "tool-call--hook";
    case "context_query":
    case "agent_plugin":
    default:
      return "tool-call--unknown";
  }
}

function nestedDisplayName(tool: NestedToolCall): string {
  if (tool.kind === "mcp_tool" && tool.mcp_server) {
    return `MCP ${tool.mcp_server} / ${tool.mcp_tool ?? tool.name}`;
  }
  return tool.name;
}

function firstStringArgument(tool: NestedToolCall): string | null {
  if (!tool.arguments || typeof tool.arguments !== "object" || Array.isArray(tool.arguments)) {
    return null;
  }
  const first = Object.values(tool.arguments)[0];
  return typeof first === "string" ? first : null;
}

function nestedSummaryText(tool: NestedToolCall): string | null {
  switch (tool.kind) {
    case "exec_command":
      return tool.command ? tool.command.join(" ") : null;
    case "patch_apply": {
      if (!tool.input_text) return null;
      const files = parseApplyPatch(tool.input_text);
      return files?.map((file) => file.path).join(", ") || null;
    }
    case "mcp_tool":
    case "web_search":
    case "image_generation":
    case "agent_plugin":
      return firstStringArgument(tool);
    default:
      return null;
  }
}

interface ParsedCommand {
  type?: string;
  cmd?: string;
}

function parsedCommands(tool: CodexToolCall): ParsedCommand[] {
  const value = tool.arguments?.parsed_cmd;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is ParsedCommand => entry !== null && typeof entry === "object",
  );
}

function commandLabel(tool: CodexToolCall): string {
  const types = parsedCommands(tool)
    .map((command) => command.type)
    .filter(Boolean);
  if (types.length === 0 || types.includes("unknown")) return "Ran";
  if (types.every((type) => type === "search")) return "Searched";
  if (types.every((type) => type === "list_files")) return "Listed";
  if (types.every((type) => type === "read")) return "Read";
  if (types.every((type) => type === "read" || type === "search" || type === "list_files")) {
    return "Searched";
  }
  return "Ran";
}

function commandSummary(tool: CodexToolCall): string | null {
  const parsed = parsedCommands(tool)
    .map((command) => command.cmd)
    .filter((command): command is string => Boolean(command));
  if (parsed.length > 0) return parsed.join("; ");
  return tool.command ? tool.command.join(" ") : null;
}

function cleanFileUri(path: string): string {
  return path.startsWith("file://") ? path.slice("file://".length) : path;
}

function displayPath(path: string, cwd: string | null): string {
  const cleanPath = cleanFileUri(path);
  const cleanCwd = cwd ? cleanFileUri(cwd).replace(/\/$/, "") : null;
  if (cleanCwd && cleanPath.startsWith(`${cleanCwd}/`)) {
    return cleanPath.slice(cleanCwd.length + 1);
  }
  return cleanPath;
}

function patchFilesFromChanges(tool: CodexToolCall): PatchFile[] {
  if (!tool.patch_changes) return [];
  return Object.entries(tool.patch_changes).map(([path, change]) => ({
    path,
    op: change.type === "add" || change.type === "delete" ? change.type : "update",
    movePath: change.move_path ?? null,
    hunks: change.unified_diff ? parseUnifiedDiff(change.unified_diff) : [],
  }));
}

function patchSummary(tool: CodexToolCall): string | null {
  const files = patchFilesFromChanges(tool);
  if (files.length === 0) return null;
  let added = 0;
  let removed = 0;
  let hasDiff = false;
  for (const file of files) {
    for (const hunk of file.hunks) {
      hasDiff = true;
      added += hunk.lines.filter((line) => line.kind === "added").length;
      removed += hunk.lines.filter((line) => line.kind === "removed").length;
    }
  }
  const paths = files.map((file) => displayPath(file.path, tool.cwd));
  const label = paths.length <= 2 ? paths.join(", ") : `${paths[0]} +${paths.length - 1} files`;
  return hasDiff ? `${label} (+${added} -${removed})` : label;
}

function toolHeaderName(tool: CodexToolCall): string {
  if (tool.name === "command_execution") return commandLabel(tool);
  if (tool.name === "file_change") return "Edited";
  if (tool.kind !== "code_mode") return tool.name;
  const nested = tool.nested_tool_calls ?? [];
  if (nested.length === 1) return nestedDisplayName(nested[0]);
  if (nested.length > 1) return `exec (${nested.length} tools)`;
  return tool.name;
}

function summaryText(tool: CodexToolCall): string | null {
  switch (tool.kind) {
    case "code_mode": {
      const nested = tool.nested_tool_calls ?? [];
      if (nested.length === 0) return null;
      return nested.map((call) => nestedSummaryText(call) ?? nestedDisplayName(call)).join(", ");
    }
    case "exec_command":
      return commandSummary(tool);
    case "web_search":
      return tool.web_query;
    case "image_generation":
      return tool.image_prompt;
    case "patch_apply":
      if (tool.patch_changes) {
        return patchSummary(tool);
      }
      return null;
    case "mcp_tool": {
      const args = tool.arguments;
      if (args && typeof args === "object" && !Array.isArray(args)) {
        const first = Object.values(args as Record<string, unknown>)[0];
        return typeof first === "string" ? first : null;
      }
      return null;
    }
    case "agent_plugin": {
      const args = tool.arguments;
      if (args && typeof args === "object" && !Array.isArray(args)) {
        const { tool_id, plugin_id } = args as Record<string, unknown>;
        const id = tool_id ?? plugin_id;
        return typeof id === "string" ? id : null;
      }
      return null;
    }
    default:
      return null;
  }
}

function looksLikeJson(s: string): boolean {
  const t = s.trimStart();
  if (t[0] !== "{" && t[0] !== "[") return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

const DIFF_LINE_CLASS: Record<DiffLine["kind"], string> = {
  context: "tool-call__diff-line tool-call__diff-line--context",
  removed: "tool-call__diff-line tool-call__diff-line--removed",
  added: "tool-call__diff-line tool-call__diff-line--added",
};

const DIFF_MARKER: Record<DiffLine["kind"], string> = {
  context: " ",
  removed: "-",
  added: "+",
};

// Render a sequence of structured diff lines with +/- markers and word-level
// highlighting. Keys mix index + byte offset + kind because lines and segments
// can repeat, so a bare index would not be unique.
function DiffLines({ lines }: { lines: DiffLine[] }) {
  const numbered = lines.some((line) => line.oldLine !== undefined || line.newLine !== undefined);
  const rows = lines.map((line, i) => {
    const lineKey = `${line.kind}${i}`;
    let offset = 0;
    const segs = line.segments.map((seg) => {
      const segKey = `${lineKey}#${offset}`;
      offset += seg.text.length;
      return { key: segKey, changed: seg.changed, text: seg.text };
    });
    return {
      key: lineKey,
      className: DIFF_LINE_CLASS[line.kind],
      marker: DIFF_MARKER[line.kind],
      oldLine: line.oldLine,
      newLine: line.newLine,
      segs,
    };
  });
  return (
    <pre className="tool-call__block tool-call__diff">
      <code>
        {rows.map((row) => (
          <div
            key={row.key}
            className={`${row.className}${numbered ? " tool-call__diff-line--numbered" : ""}`}
          >
            {numbered && (
              <>
                <span className="tool-call__diff-line-number">{row.oldLine ?? ""}</span>
                <span className="tool-call__diff-line-number">{row.newLine ?? ""}</span>
              </>
            )}
            <span className="tool-call__diff-marker">{row.marker}</span>
            <span className="tool-call__diff-content">
              {row.segs.map((seg) =>
                seg.changed ? (
                  <span key={seg.key} className="tool-call__diff-word">
                    {seg.text}
                  </span>
                ) : (
                  <span key={seg.key}>{seg.text}</span>
                ),
              )}
            </span>
          </div>
        ))}
      </code>
    </pre>
  );
}

// Stable, data-derived key for a hunk (its lines never reorder once parsed).
function hunkKey(file: PatchFile, hunk: PatchFile["hunks"][number]): string {
  const first = hunk.lines[0]?.segments.map((s) => s.text).join("") ?? "";
  return `${file.path}\0${hunk.header}\0${hunk.lines.length}\0${first}`;
}

function PatchDiff({ files, cwd = null }: { files: PatchFile[]; cwd?: string | null }) {
  return (
    <div className="tool-call__block tool-call__patch">
      {files.map((file) => (
        <div key={`${file.op}\0${file.path}`} className="tool-call__patch-file">
          <div className="tool-call__patch-file-header">
            <span className={`tool-call__patch-type tool-call__patch-type--${file.op}`}>
              {file.op}
            </span>
            <span className="tool-call__patch-path">{displayPath(file.path, cwd)}</span>
            {file.movePath && (
              <span className="tool-call__patch-path">→ {displayPath(file.movePath, cwd)}</span>
            )}
          </div>
          {file.hunks.map((hunk) => (
            <div key={hunkKey(file, hunk)} className="tool-call__diff-hunk">
              {hunk.header && <div className="tool-call__diff-hunk-header">@@ {hunk.header}</div>}
              <DiffLines lines={hunk.lines} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ToolCallItem({
  tool,
  expanded,
  onToggle,
  isWorkerOpen,
  onOpenWorker,
}: ToolCallItemProps) {
  const handleToggle = useCallback(() => onToggle(), [onToggle]);
  const [popout, setPopout] = useState(false);

  const failed =
    (tool.exit_code !== null && tool.exit_code !== 0) ||
    tool.patch_success === false ||
    tool.status === "failed";
  const summary = summaryText(tool);
  const headerName = toolHeaderName(tool);

  return (
    <div className={`tool-call ${kindClass(tool.kind)}${failed ? " tool-call--failed" : ""}`}>
      <div
        className="tool-call__header"
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleToggle();
        }}
      >
        <span className="tool-call__chevron">{expanded ? "▼" : "▶"}</span>
        <span className="tool-call__icon">{kindIcon(tool.kind, failed)}</span>
        <span className="tool-call__name">
          {tool.kind === "mcp_tool" && tool.mcp_server ? (
            <>
              <span className="tool-call__mcp-prefix">MCP {tool.mcp_server}</span>
              {" / "}
              {tool.mcp_tool ?? tool.name}
            </>
          ) : (
            headerName
          )}
        </span>
        {summary && <span className="tool-call__summary">{summary}</span>}
        {tool.exit_code !== null && (
          <span
            className={`tool-call__exit${tool.exit_code !== 0 ? " tool-call__exit--fail" : ""}`}
          >
            exit {tool.exit_code}
          </span>
        )}
        {tool.duration_secs !== null && (
          <span className="tool-call__duration">{formatDuration(tool.duration_secs * 1000)}</span>
        )}
        {tool.kind === "spawn_agent" && tool.worker_session && onOpenWorker && (
          <button
            className={`tool-call__worker-btn${isWorkerOpen ? " tool-call__worker-btn--open" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpenWorker(tool);
            }}
            title={isWorkerOpen ? "Close worker panel" : "Open worker session"}
          >
            {isWorkerOpen ? "Close" : "Open"}
          </button>
        )}
        <button
          className={`tool-call__popout-btn${tool.duration_secs === null && !(tool.kind === "spawn_agent" && tool.worker_session && onOpenWorker) ? " tool-call__popout-btn--push" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setPopout(true);
          }}
          title="View full content"
        >
          <PopoutIcon />
        </button>
      </div>

      {expanded && <ToolCallBody tool={tool} />}

      {popout && (
        <PopoutModal
          onClose={() => setPopout(false)}
          header={
            <>
              <span className="tool-call__icon">{kindIcon(tool.kind, failed)}</span>
              <span className="popout-modal__name">{headerName}</span>
              {tool.exit_code !== null && (
                <span
                  className={`tool-call__exit${tool.exit_code !== 0 ? " tool-call__exit--fail" : ""}`}
                >
                  exit {tool.exit_code}
                </span>
              )}
            </>
          }
        >
          <ToolCallBody tool={tool} popout />
        </PopoutModal>
      )}
    </div>
  );
}

/**
 * Everything behind a tool call's chevron: command/input, diff, output.
 *
 * Exported because the chat transcript expands a tool line into this same body
 * instead of navigating away to the turn detail.
 */
export function ToolCallBody({ tool, popout = false }: { tool: CodexToolCall; popout?: boolean }) {
  const cls = popout ? "tool-call__body tool-call__body--popout" : "tool-call__body";
  const patchFiles = useMemo(() => {
    if (tool.kind !== "patch_apply") return null;
    if (tool.input_text) {
      const parsed = parseApplyPatch(tool.input_text);
      if (parsed) return parsed;
    }
    const files = patchFilesFromChanges(tool);
    return files.length > 0 ? files : null;
  }, [tool]);
  return (
    <div className={cls}>
      {tool.kind === "code_mode" && <CodeModeBody tool={tool} />}

      {/* Input section */}
      {tool.kind === "exec_command" && (tool.command || tool.arguments) && (
        <div className="tool-call__section tool-call__section--input">
          <div className="tool-call__section-title">Command</div>
          {tool.command ? (
            <pre className="tool-call__block tool-call__cmd">{tool.command.join(" ")}</pre>
          ) : (
            <pre className="tool-call__block tool-call__json">
              <code>{formatJson(JSON.stringify(tool.arguments))}</code>
            </pre>
          )}
          {tool.cwd && <div className="tool-call__cwd">cwd: {tool.cwd}</div>}
          {tool.plugin_id && (
            <div className="tool-call__plugin-info">
              plugin: {tool.plugin_id}
              {tool.script_path && ` (${tool.script_path})`}
            </div>
          )}
        </div>
      )}

      {tool.kind === "mcp_tool" && (
        <div className="tool-call__section tool-call__section--input">
          <div className="tool-call__section-title">Input</div>
          <div className="tool-call__block tool-call__mcp-info">
            {tool.mcp_server && <span className="tool-call__mcp-server">{tool.mcp_server}</span>}
            {tool.mcp_tool && <span className="tool-call__mcp-tool"> / {tool.mcp_tool}</span>}
          </div>
          {tool.plugin_id && <div className="tool-call__plugin-info">plugin: {tool.plugin_id}</div>}
          {tool.arguments && Object.keys(tool.arguments).length > 0 && (
            <pre className="tool-call__block tool-call__json">
              <code>{formatJson(JSON.stringify(tool.arguments))}</code>
            </pre>
          )}
        </div>
      )}

      {tool.kind === "patch_apply" && patchFiles && (
        <div className="tool-call__section tool-call__section--input">
          <div className="tool-call__section-title">Changes</div>
          <PatchDiff files={patchFiles} cwd={tool.cwd} />
        </div>
      )}

      {tool.kind === "patch_apply" && !patchFiles && !tool.patch_changes && tool.input_text && (
        <div className="tool-call__section tool-call__section--input">
          <div className="tool-call__section-title">Patch</div>
          <pre className="tool-call__block tool-call__diff">{tool.input_text}</pre>
        </div>
      )}

      {tool.kind === "web_search" && (
        <div className="tool-call__section tool-call__section--input">
          <div className="tool-call__section-title">Query</div>
          <div className="tool-call__block tool-call__web">
            {tool.web_query && <div>{tool.web_query}</div>}
            {tool.web_url && <div className="tool-call__web-url">{tool.web_url}</div>}
          </div>
        </div>
      )}

      {tool.kind === "image_generation" && tool.image_prompt && (
        <div className="tool-call__section tool-call__section--input">
          <div className="tool-call__section-title">Prompt</div>
          <div className="tool-call__block tool-call__image-prompt">{tool.image_prompt}</div>
        </div>
      )}

      {(tool.kind === "spawn_agent" ||
        tool.kind === "wait_agent" ||
        tool.kind === "interrupt_agent" ||
        tool.kind === "followup_task") &&
        Object.keys(tool.arguments ?? {}).length > 0 && (
          <div className="tool-call__section tool-call__section--input">
            <div className="tool-call__section-title">Arguments</div>
            <pre className="tool-call__block tool-call__json">
              <code>{formatJson(JSON.stringify(tool.arguments))}</code>
            </pre>
          </div>
        )}

      {(tool.kind === "unknown" || tool.kind === "context_query" || tool.kind === "agent_plugin") &&
        tool.arguments != null &&
        Object.keys(tool.arguments).length > 0 && (
          <div className="tool-call__section tool-call__section--input">
            <div className="tool-call__section-title">Input</div>
            <pre className="tool-call__block tool-call__json">
              <code>{formatJson(JSON.stringify(tool.arguments))}</code>
            </pre>
          </div>
        )}

      {tool.output !== null && (
        <div className="tool-call__section tool-call__section--output">
          <div className="tool-call__section-title">Output</div>
          <pre
            className={`tool-call__output${tool.exit_code !== null && tool.exit_code !== 0 ? " tool-call__output--error" : ""}`}
          >
            {looksLikeJson(tool.output) ? <code>{formatJson(tool.output)}</code> : tool.output}
          </pre>
          {tool.output_truncated === true && (
            <div className="tool-call__truncation-notice">
              Output was truncated by the Codex runtime (v0.145.0+). The displayed output is
              partial.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function hasArguments(argumentsValue: Record<string, unknown>): boolean {
  return Object.keys(argumentsValue).length > 0;
}

function NestedToolCallView({ tool }: { tool: NestedToolCall }) {
  const summary = nestedSummaryText(tool);
  const patchFiles =
    tool.kind === "patch_apply" && tool.input_text ? parseApplyPatch(tool.input_text) : null;
  const showJson =
    tool.kind !== "exec_command" && tool.kind !== "patch_apply" && hasArguments(tool.arguments);

  return (
    <div className="tool-call__nested-call">
      <div className="tool-call__nested-header">
        <span className="tool-call__icon">{kindIcon(tool.kind, false)}</span>
        <span className="tool-call__nested-name">{nestedDisplayName(tool)}</span>
        {summary && <span className="tool-call__nested-summary">{summary}</span>}
      </div>

      {tool.kind === "exec_command" && (tool.command || hasArguments(tool.arguments)) && (
        <>
          {tool.command ? (
            <pre className="tool-call__block tool-call__cmd tool-call__nested-command">
              {tool.command.join(" ")}
            </pre>
          ) : (
            <pre className="tool-call__block tool-call__json">
              <code>{formatJson(JSON.stringify(tool.arguments))}</code>
            </pre>
          )}
          {tool.cwd && <div className="tool-call__cwd">cwd: {tool.cwd}</div>}
        </>
      )}

      {tool.kind === "patch_apply" && patchFiles && <PatchDiff files={patchFiles} />}

      {tool.kind === "patch_apply" && !patchFiles && tool.input_text && (
        <pre className="tool-call__block tool-call__diff">{tool.input_text}</pre>
      )}

      {showJson && (
        <pre className="tool-call__block tool-call__json">
          <code>{formatJson(JSON.stringify(tool.arguments))}</code>
        </pre>
      )}

      {tool.cwd && tool.kind !== "exec_command" && (
        <div className="tool-call__cwd">cwd: {tool.cwd}</div>
      )}
    </div>
  );
}

function CodeModeBody({ tool }: { tool: CodexToolCall }) {
  const nested = tool.nested_tool_calls ?? [];
  return (
    <>
      {nested.length > 0 && (
        <div className="tool-call__section tool-call__section--input">
          <div className="tool-call__section-title">Operations ({nested.length})</div>
          <div className="tool-call__nested-list">
            {nested.map((nestedTool) => (
              <NestedToolCallView
                key={`${nestedTool.kind}:${nestedTool.name}:${nestedTool.cwd ?? ""}:${nestedTool.input_text ?? ""}:${JSON.stringify(nestedTool.arguments)}`}
                tool={nestedTool}
              />
            ))}
          </div>
        </div>
      )}

      {tool.input_text && (
        <div className="tool-call__section tool-call__section--input">
          <div className="tool-call__section-title">JavaScript</div>
          <pre className="tool-call__block tool-call__code">{tool.input_text}</pre>
        </div>
      )}
    </>
  );
}

export function RawExecDetails({ tool }: { tool: CodexToolCall }) {
  return (
    <details className="tool-call__raw-details">
      <summary>Raw exec details</summary>
      <div className="tool-call__raw-body">
        {tool.input_text && (
          <div className="tool-call__section tool-call__section--input">
            <div className="tool-call__section-title">JavaScript</div>
            <pre className="tool-call__block tool-call__code">{tool.input_text}</pre>
          </div>
        )}
        {tool.output !== null && (
          <div className="tool-call__section tool-call__section--output">
            <div className="tool-call__section-title">Output</div>
            <pre
              className={`tool-call__output${tool.exit_code !== null && tool.exit_code !== 0 ? " tool-call__output--error" : ""}`}
            >
              {looksLikeJson(tool.output) ? <code>{formatJson(tool.output)}</code> : tool.output}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}
