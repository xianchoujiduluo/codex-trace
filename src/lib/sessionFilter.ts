import type { CodexSessionInfo } from "../../shared/types";

export type SessionFilter = "all" | "active" | "recent";
export type SessionSortOrder = "newest" | "oldest";

/** Number of sessions shown by the Recent picker filter. */
export const RECENT_SESSION_LIMIT = 10;

/** Worker rollouts are inspected through their parent turn, not as standalone sessions. */
export function isPrimarySession(session: CodexSessionInfo): boolean {
  return !session.is_external_worker && !session.is_inline_worker;
}

function sessionTimestamp(session: CodexSessionInfo): number | null {
  const timestamp = Date.parse(session.last_activity_time);
  return Number.isNaN(timestamp) ? null : timestamp;
}

/** Sort sessions by their latest valid rollout entry, preserving input order for ties. */
export function sortSessionsByActivity(
  sessions: CodexSessionInfo[],
  order: SessionSortOrder = "newest",
): CodexSessionInfo[] {
  return sessions
    .map((session, index) => ({ session, index, timestamp: sessionTimestamp(session) }))
    .toSorted((a, b) => {
      if (a.timestamp !== null && b.timestamp !== null && a.timestamp !== b.timestamp) {
        return order === "newest" ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
      }
      if (a.timestamp !== null && b.timestamp === null) return -1;
      if (a.timestamp === null && b.timestamp !== null) return 1;
      return a.index - b.index;
    })
    .map(({ session }) => session);
}

/** Activity date in the browser's local timezone, matching the displayed activity time. */
export function sessionActivityDateGroup(session: CodexSessionInfo): string {
  const timestamp = sessionTimestamp(session);
  if (timestamp === null) return session.date_group || "unknown";

  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

export function filterSessions(
  sessions: CodexSessionInfo[],
  filter: SessionFilter,
): CodexSessionInfo[] {
  const sorted = sortSessionsByActivity(sessions);

  if (filter === "active") {
    return sorted.filter((session) => session.is_ongoing);
  }

  if (filter === "recent") {
    return sorted.slice(0, RECENT_SESSION_LIMIT);
  }

  return sorted;
}

/** Provider ids that can appear on session rows. */
export type ProviderFilter = "all" | "codex" | "claude" | "pi";

/** Human-readable label for a provider id. */
export function providerLabel(provider: string): string {
  if (provider === "claude") return "Claude";
  if (provider === "pi") return "pi";
  return "Codex";
}

/** The provider backing a session; sessions from older backends are codex. */
export function sessionProvider(session: CodexSessionInfo): string {
  return session.provider ?? "codex";
}

/** Keep only sessions of the selected provider ("all" keeps everything). */
export function filterSessionsByProvider(
  sessions: CodexSessionInfo[],
  filter: ProviderFilter,
): CodexSessionInfo[] {
  if (filter === "all") return sessions;
  return sessions.filter((session) => sessionProvider(session) === filter);
}

/** Provider ids present in the session list, in stable display order. */
export function presentProviders(sessions: CodexSessionInfo[]): ProviderFilter[] {
  const present = new Set(sessions.map(sessionProvider));
  const order: ProviderFilter[] = ["codex", "claude", "pi"];
  return order.filter((provider) => present.has(provider));
}
