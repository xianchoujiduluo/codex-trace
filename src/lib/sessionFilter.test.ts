import { describe, expect, it } from "vitest";
import type { CodexSessionInfo } from "../../shared/types";
import {
  filterSessions,
  filterSessionsByProvider,
  isPrimarySession,
  presentProviders,
  providerLabel,
  RECENT_SESSION_LIMIT,
  sessionActivityDateGroup,
  sessionProvider,
} from "./sessionFilter";

function makeSession(
  id: string,
  startTime: string,
  isOngoing = false,
  lastActivityTime = startTime,
): CodexSessionInfo {
  return {
    id,
    path: `/sessions/rollout-${id}.jsonl`,
    cwd: null,
    git_branch: null,
    originator: null,
    model: null,
    cli_version: null,
    thread_name: id,
    turn_count: 1,
    start_time: startTime,
    end_time: null,
    total_tokens: null,
    is_ongoing: isOngoing,
    is_external_worker: false,
    is_inline_worker: false,
    is_headless: false,
    is_archived: false,
    approval_mode: null,
    history_base_thread_id: null,
    last_activity_time: lastActivityTime,
    file_size_bytes: 0,
    worker_nickname: null,
    worker_role: null,
    spawned_worker_ids: [],
    date_group: "2026/08/18",
    ai_title: null,
  };
}

describe("filterSessions", () => {
  it("returns only ongoing sessions for the active filter", () => {
    const sessions = [
      makeSession("done", "2026-08-18T12:00:00Z"),
      makeSession("active", "2026-08-18T12:01:00Z", true),
    ];

    expect(filterSessions(sessions, "active").map((session) => session.id)).toEqual(["active"]);
  });

  it("returns the ten most recently active sessions", () => {
    const sessions = Array.from({ length: RECENT_SESSION_LIMIT + 1 }, (_, index) =>
      makeSession(
        `session-${index}`,
        "2026-01-01T00:00:00Z",
        false,
        `2026-08-18T12:${String(index).padStart(2, "0")}:00Z`,
      ),
    );

    expect(filterSessions(sessions, "recent").map((session) => session.id)).toEqual(
      Array.from(
        { length: RECENT_SESSION_LIMIT },
        (_, index) => `session-${index + 1}`,
      ).toReversed(),
    );
  });

  it("keeps sessions with invalid timestamps after dated sessions", () => {
    const sessions = [
      makeSession("invalid", "2026-08-19T12:00:00Z", false, "not-a-date"),
      makeSession("dated", "2026-01-01T12:00:00Z", false, "2026-08-18T12:00:00Z"),
    ];

    expect(filterSessions(sessions, "recent").map((session) => session.id)).toEqual([
      "dated",
      "invalid",
    ]);
  });

  it("puts an older session with newer activity first", () => {
    const sessions = [
      makeSession("newly-created", "2026-08-19T12:00:00Z", false, "2026-08-19T12:05:00Z"),
      makeSession("old-but-resumed", "2026-01-01T12:00:00Z", false, "2026-08-20T09:00:00Z"),
    ];

    expect(filterSessions(sessions, "recent").map((session) => session.id)).toEqual([
      "old-but-resumed",
      "newly-created",
    ]);
  });

  it("sorts the all filter by latest activity", () => {
    const sessions = [
      makeSession("older-activity", "2026-08-20T12:00:00Z", false, "2026-08-20T12:01:00Z"),
      makeSession("newer-activity", "2026-01-01T12:00:00Z", false, "2026-08-20T13:00:00Z"),
    ];

    expect(filterSessions(sessions, "all").map((session) => session.id)).toEqual([
      "newer-activity",
      "older-activity",
    ]);
  });

  it("derives the group from activity and falls back for invalid timestamps", () => {
    expect(
      sessionActivityDateGroup(
        makeSession("active", "2026-01-01T12:00:00Z", false, "2026-08-20T12:00:00Z"),
      ),
    ).toBe("2026/08/20");
    expect(
      sessionActivityDateGroup({
        ...makeSession("invalid", "2026-01-01T12:00:00Z", false, "invalid"),
        date_group: "2026/01/01",
      }),
    ).toBe("2026/01/01");
  });
});

describe("isPrimarySession", () => {
  it("excludes both linked and unlinked worker rollouts", () => {
    expect(isPrimarySession(makeSession("primary", "2026-08-20T12:00:00Z"))).toBe(true);
    expect(
      isPrimarySession({
        ...makeSession("external-worker", "2026-08-20T12:00:00Z"),
        is_external_worker: true,
      }),
    ).toBe(false);
    expect(
      isPrimarySession({
        ...makeSession("inline-worker", "2026-08-20T12:00:00Z"),
        is_inline_worker: true,
      }),
    ).toBe(false);
  });
});

describe("sessionProvider", () => {
  it("reads the provider field and defaults to codex", () => {
    expect(sessionProvider({ ...makeSession("s1", "2026-08-20T12:00:00Z"), provider: "pi" })).toBe(
      "pi",
    );
    // Sessions from older backends carry no provider field.
    expect(sessionProvider(makeSession("s2", "2026-08-20T12:00:00Z"))).toBe("codex");
  });
});

describe("filterSessionsByProvider", () => {
  it("keeps every session for the all filter", () => {
    const sessions = [
      { ...makeSession("a", "2026-08-20T12:00:00Z"), provider: "codex" },
      { ...makeSession("b", "2026-08-21T12:00:00Z"), provider: "claude" },
    ];
    expect(filterSessionsByProvider(sessions, "all")).toHaveLength(2);
  });

  it("filters by provider and treats missing provider as codex", () => {
    const sessions = [
      { ...makeSession("a", "2026-08-20T12:00:00Z"), provider: "codex" },
      { ...makeSession("b", "2026-08-21T12:00:00Z"), provider: "claude" },
      makeSession("c", "2026-08-22T12:00:00Z"),
      { ...makeSession("d", "2026-08-23T12:00:00Z"), provider: "pi" },
    ];
    expect(filterSessionsByProvider(sessions, "claude").map((s) => s.id)).toEqual(["b"]);
    expect(filterSessionsByProvider(sessions, "pi").map((s) => s.id)).toEqual(["d"]);
    expect(filterSessionsByProvider(sessions, "codex").map((s) => s.id)).toEqual(["a", "c"]);
  });
});

describe("presentProviders", () => {
  it("lists only providers with sessions in display order", () => {
    const sessions = [
      { ...makeSession("a", "2026-08-20T12:00:00Z"), provider: "pi" },
      { ...makeSession("b", "2026-08-21T12:00:00Z"), provider: "codex" },
      { ...makeSession("c", "2026-08-22T12:00:00Z"), provider: "claude" },
    ];
    expect(presentProviders(sessions)).toEqual(["codex", "claude", "pi"]);
  });

  it("hides providers without sessions", () => {
    const sessions = [{ ...makeSession("a", "2026-08-20T12:00:00Z"), provider: "codex" }];
    expect(presentProviders(sessions)).toEqual(["codex"]);
  });
});

describe("providerLabel", () => {
  it("renders human-readable names", () => {
    expect(providerLabel("claude")).toBe("Claude");
    expect(providerLabel("pi")).toBe("pi");
    expect(providerLabel("codex")).toBe("Codex");
  });
});
