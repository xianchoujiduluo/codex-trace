import { describe, expect, it } from "vitest";
import { parseSessionPath, resolveSessionLink, sessionPath } from "./sessionLink";

describe("parseSessionPath", () => {
  it("reads a provider and session id", () => {
    expect(parseSessionPath("/pi/01a0af51-7656-70cb-8f13-c71f033d3fbb")).toEqual({
      provider: "pi",
      sessionId: "01a0af51-7656-70cb-8f13-c71f033d3fbb",
    });
    expect(parseSessionPath("/codex/rollout-2026-09-17T14-13-04-01a0adff")).toEqual({
      provider: "codex",
      sessionId: "rollout-2026-09-17T14-13-04-01a0adff",
    });
    expect(parseSessionPath("/claude/73cda16f-0c01-4bcf-97e7-2b5aeb3ab9ea")).toEqual({
      provider: "claude",
      sessionId: "73cda16f-0c01-4bcf-97e7-2b5aeb3ab9ea",
    });
  });

  it("resolves the link through a deployment sub-path", () => {
    // The app can be proxied under a prefix; the last two segments still name
    // the session.
    expect(parseSessionPath("/some/prefix/pi/abc-123")).toEqual({
      provider: "pi",
      sessionId: "abc-123",
    });
  });

  it("returns null for paths that are not session links", () => {
    for (const path of ["/", "/index.html", "/pi", "/nope/abc", "/pi/", "//", ""]) {
      expect(parseSessionPath(path)).toBeNull();
    }
  });

  it("rejects ids that would make an unusable link", () => {
    // Slashes and spaces cannot survive a round trip through the address bar.
    expect(parseSessionPath("/pi/a b")).toBeNull();
    expect(parseSessionPath("/pi/a%2Fb")).toBeNull();
  });
});

describe("sessionPath", () => {
  it("round-trips with parseSessionPath", () => {
    const link = { provider: "pi", sessionId: "01a0af51-7656-70cb-8f13-c71f033d3fbb" };
    expect(parseSessionPath(sessionPath(link.provider, link.sessionId))).toEqual(link);
  });

  it("falls back to codex for an unknown provider", () => {
    // An unknown provider must still produce a loadable path rather than a link
    // that parses to null.
    expect(sessionPath("gemini", "abc")).toBe("/codex/abc");
    expect(parseSessionPath(sessionPath("gemini", "abc"))).not.toBeNull();
  });
});

describe("resolveSessionLink", () => {
  const sessions = [
    { id: "a1", path: "/sessions/a1.jsonl", provider: "codex" },
    { id: "b2", path: "/sessions/b2.jsonl", provider: "pi" },
  ];

  it("matches a session by id and provider", () => {
    expect(resolveSessionLink(sessions, { provider: "pi", sessionId: "b2" })?.path).toBe(
      "/sessions/b2.jsonl",
    );
    expect(resolveSessionLink(sessions, { provider: "codex", sessionId: "a1" })?.path).toBe(
      "/sessions/a1.jsonl",
    );
  });

  it("returns null for an unknown id or no link", () => {
    expect(resolveSessionLink(sessions, { provider: "pi", sessionId: "zz" })).toBeNull();
    expect(resolveSessionLink(sessions, null)).toBeNull();
  });

  it("does not open another agent's session when ids collide", () => {
    // Each agent mints ids on its own, so an id is not guaranteed unique across
    // agents. Resolving on the id alone would open whichever came first in the
    // list — a different conversation than the link named, with no error.
    const shared = [
      { id: "same-id", path: "/codex/same-id.jsonl", provider: "codex" },
      { id: "same-id", path: "/pi/same-id.jsonl", provider: "pi" },
    ];
    expect(resolveSessionLink(shared, { provider: "pi", sessionId: "same-id" })?.path).toBe(
      "/pi/same-id.jsonl",
    );
    expect(resolveSessionLink(shared, { provider: "codex", sessionId: "same-id" })?.path).toBe(
      "/codex/same-id.jsonl",
    );
  });

  it("treats a session with no provider as codex", () => {
    // Older sessions predate the provider field; `sessionProvider` defaults them
    // to codex, and link resolution must agree or those links stop working.
    const legacy = [{ id: "old", path: "/sessions/old.jsonl" }];
    expect(resolveSessionLink(legacy, { provider: "codex", sessionId: "old" })?.path).toBe(
      "/sessions/old.jsonl",
    );
    expect(resolveSessionLink(legacy, { provider: "pi", sessionId: "old" })).toBeNull();
  });
});
