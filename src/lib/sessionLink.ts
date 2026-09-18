/**
 * Deep links into a session.
 *
 * A session is addressable as `/<provider>/<session-id>`, e.g.
 * `/pi/01a0af51-7656-70cb-8f13-c71f033d3fbb`. External tools (herdr's quick
 * jump) need to link straight to a conversation, which the previous
 * single-page-with-no-routes setup could not express.
 *
 * The path is the source of truth for *which* session is open. The view state
 * (picker / list / detail) is not encoded: opening a session always starts in
 * the transcript, which is what a deep link is asking for.
 */

/** Providers that can appear in a link, matching `Provider` in the parser. */
const LINK_PROVIDERS = ["codex", "claude", "pi"] as const;
export type LinkProvider = (typeof LINK_PROVIDERS)[number];

export interface SessionLink {
  provider: string;
  sessionId: string;
}

/**
 * Parse `location.pathname`.
 *
 * Returns `null` for anything that is not a session link — the app is also
 * served from `/` and, in some deployments, from a sub-path (`CODEXTRACE_*`
 * proxies), so unknown paths must fall back to the picker rather than error.
 */
export function parseSessionPath(pathname: string): SessionLink | null {
  const segments = pathname.split("/").filter(Boolean);
  // Take the last two segments so a deployment sub-path still resolves.
  if (segments.length < 2) return null;
  const [provider, sessionId] = segments.slice(-2);
  if (!(LINK_PROVIDERS as readonly string[]).includes(provider)) return null;
  if (!sessionId) return null;
  // Session ids are UUIDs (pi, Claude Code) or Codex rollout ids; reject
  // anything that would make an unusable link.
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) return null;
  return { provider, sessionId };
}

/** Build the path for a session. */
export function sessionPath(provider: string, sessionId: string): string {
  const safe = (LINK_PROVIDERS as readonly string[]).includes(provider) ? provider : "codex";
  return `/${safe}/${sessionId}`;
}

/**
 * Replace the address bar without adding a history entry.
 *
 * `replaceState` deliberately: picking sessions one after another would
 * otherwise stack entries, and the browser Back button would walk through every
 * conversation visited instead of leaving the app. Opening a session is a change
 * of content, not a navigation the user made.
 */
export function syncSessionPath(link: SessionLink | null): void {
  if (typeof window === "undefined") return;
  const next = link ? sessionPath(link.provider, link.sessionId) : "/";
  if (window.location.pathname === next) return;
  window.history.replaceState(null, "", next);
}

/**
 * The session a link refers to, matched against discovered sessions.
 *
 * Links carry the session id, but loading needs the file path, so the id is
 * resolved against the picker's list. A miss means the id is unknown (session
 * deleted, or a link from another machine) and is reported rather than guessed
 * at.
 *
 * The link's provider must match too. Each agent mints ids independently — Codex
 * from its CLI, pi and Claude Code from their own UUID generators — so nothing
 * guarantees an id is unique across agents. Matching on the id alone would then
 * open whichever session happened to come first in the list, silently showing a
 * different conversation than the link named. A session with no provider is
 * treated as `codex`, matching `sessionProvider`.
 */
export function resolveSessionLink<T extends { id: string; path: string; provider?: string }>(
  sessions: T[],
  link: SessionLink | null,
): T | null {
  if (!link) return null;
  return (
    sessions.find(
      (session) => session.id === link.sessionId && (session.provider ?? "codex") === link.provider,
    ) ?? null
  );
}
