import type { CodexToolCall, CodexTurn } from "../../shared/types";

export function toolSearchText(tool: CodexToolCall): string {
  return [
    tool.name,
    tool.kind,
    tool.command?.join(" "),
    tool.input_text,
    tool.output,
    tool.web_query,
    tool.web_url,
    tool.image_prompt,
    tool.mcp_server,
    tool.mcp_tool,
    tool.plugin_id,
    JSON.stringify(tool.arguments),
    JSON.stringify(tool.patch_changes),
    ...(tool.nested_tool_calls ?? []).flatMap((nested) => [
      nested.name,
      nested.kind,
      nested.command?.join(" "),
      nested.input_text,
      nested.mcp_server,
      nested.mcp_tool,
      JSON.stringify(nested.arguments),
    ]),
  ]
    .filter(Boolean)
    .join("\n");
}

export function turnSearchText(turn: CodexTurn): string {
  return [
    turn.user_message,
    turn.error,
    turn.final_answer,
    turn.thread_name,
    ...turn.agent_messages.map((message) => message.text),
    ...(turn.warnings ?? []),
    ...turn.tool_calls.map(toolSearchText),
  ]
    .filter(Boolean)
    .join("\n");
}

export function matchesTurn(turn: CodexTurn, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return turnSearchText(turn).toLocaleLowerCase().includes(normalizedQuery);
}

export function matchesText(text: string | null | undefined, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return Boolean(normalizedQuery) && Boolean(text?.toLocaleLowerCase().includes(normalizedQuery));
}
