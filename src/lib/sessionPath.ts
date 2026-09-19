/** Return a session file path relative to the Codex sessions directory. */
export function sessionRelativePath(path: string, dateGroup?: string): string {
  const normalized = path.replaceAll("\\", "/");
  const marker = "/sessions/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex >= 0) return normalized.slice(markerIndex + marker.length);

  const parts = normalized.split("/").filter(Boolean);
  const sessionsIndex = parts.lastIndexOf("sessions");
  if (sessionsIndex >= 0 && sessionsIndex < parts.length - 1) {
    return parts.slice(sessionsIndex + 1).join("/");
  }

  const fileName = parts.at(-1);
  if (dateGroup && fileName) return `${dateGroup.replaceAll("\\", "/")}/${fileName}`;
  return fileName ?? normalized;
}

/**
 * Agent-home markers. Each one stands in for the user's `~`, so the path is
 * `<home>` + marker + `<rest>`.
 */
const AGENT_HOME_MARKERS = [
  "/.pi/agent/sessions/",
  "/.claude/projects/",
  "/.config/codex/sessions/",
  "/.codex/sessions/",
];

/**
 * Return a session file path anchored at `~/`, the agent home directory.
 *
 * The absolute path a backend reports is its *own* view of the filesystem. In
 * Docker the agent homes are bind-mounted onto `/home/app/...`, so copying
 * `session.path` verbatim hands the user a path that only exists inside the
 * container. Anchoring on the home marker yields `~/.pi/agent/sessions/...`
 * instead, which expands to the real file on whichever machine the user pastes
 * it into — container or host, no configuration needed.
 *
 * Falls back to the absolute path when no known agent-home marker is present
 * (custom sessions directories), since guessing a `~/` prefix would be worse
 * than leaving the path alone.
 */
export function sessionTildePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  // The *outermost* (earliest) marker is the agent home: a session id can
  // legitimately contain a marker-shaped suffix of its own (pi derives the
  // project directory from a path), so `lastIndexOf` would strip too much.
  let best: { index: number; marker: string } | null = null;
  for (const marker of AGENT_HOME_MARKERS) {
    const index = normalized.indexOf(marker);
    // index <= 0 means root-level, i.e. no home directory to replace.
    if (index <= 0) continue;
    if (!best || index < best.index) best = { index, marker };
  }
  if (!best) return normalized;
  // Keep the marker: `~` replaces only the home directory before it.
  return `~${normalized.slice(best.index)}`;
}
