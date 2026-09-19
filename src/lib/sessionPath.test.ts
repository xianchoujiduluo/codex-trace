import { describe, expect, it } from "vitest";
import { sessionRelativePath, sessionTildePath } from "./sessionPath";

describe("sessionRelativePath", () => {
  it("removes the path through the sessions directory", () => {
    expect(sessionRelativePath("/home/user/.codex/sessions/2026/08/20/rollout-a.jsonl")).toBe(
      "2026/08/20/rollout-a.jsonl",
    );
  });

  it("handles Windows separators", () => {
    expect(
      sessionRelativePath("C:\\Users\\user\\.codex\\sessions\\2026\\08\\20\\rollout-a.jsonl"),
    ).toBe("2026/08/20/rollout-a.jsonl");
  });

  it("uses the date group when a custom sessions directory has another name", () => {
    expect(sessionRelativePath("/data/codex/rollout-a.jsonl", "2026/08/20")).toBe(
      "2026/08/20/rollout-a.jsonl",
    );
  });
});

describe("sessionTildePath", () => {
  it("roots a codex path at the home directory", () => {
    expect(sessionTildePath("/home/administrator/.codex/sessions/2026/08/20/rollout-a.jsonl")).toBe(
      "~/.codex/sessions/2026/08/20/rollout-a.jsonl",
    );
  });

  it("roots pi and claude paths at the home directory", () => {
    expect(
      sessionTildePath(
        "/home/app/.pi/agent/sessions/--home-administrator--/2026-09-13T13-28-18-318Z_abc.jsonl",
      ),
    ).toBe("~/.pi/agent/sessions/--home-administrator--/2026-09-13T13-28-18-318Z_abc.jsonl");
    expect(sessionTildePath("/home/app/.claude/projects/-tmp-cctmp/73cda16f.jsonl")).toBe(
      "~/.claude/projects/-tmp-cctmp/73cda16f.jsonl",
    );
  });

  it("rewrites the container home, not just the host home", () => {
    // The whole point: the backend reports its own $HOME, and Docker mounts the
    // agent homes under /home/app. Copying that verbatim gives a path that does
    // not exist on the user's machine, so the home directory has to be replaced
    // rather than preserved.
    expect(sessionTildePath("/home/app/.codex/sessions/2026/04/26/rollout-abc.jsonl")).toBe(
      "~/.codex/sessions/2026/04/26/rollout-abc.jsonl",
    );
    expect(sessionTildePath("/Users/someone/.codex/sessions/2026/04/26/rollout-abc.jsonl")).toBe(
      "~/.codex/sessions/2026/04/26/rollout-abc.jsonl",
    );
  });

  it("handles Windows separators", () => {
    expect(
      sessionTildePath("C:\\Users\\user\\.codex\\sessions\\2026\\08\\20\\rollout-a.jsonl"),
    ).toBe("~/.codex/sessions/2026/08/20/rollout-a.jsonl");
  });

  it("prefers the outermost agent home when the session id contains another", () => {
    // pi derives the project directory from a path, so a session id can contain
    // a marker-shaped fragment. The home is the *first* marker, not the last.
    expect(sessionTildePath("/home/app/.pi/agent/sessions/--x--/.codex/sessions/a.jsonl")).toBe(
      "~/.pi/agent/sessions/--x--/.codex/sessions/a.jsonl",
    );
  });

  it("leaves a custom sessions directory alone", () => {
    // No known agent home to anchor on, so `~` would be a guess. Better to hand
    // back exactly what the backend said.
    expect(sessionTildePath("/data/codex/rollout-a.jsonl")).toBe("/data/codex/rollout-a.jsonl");
  });

  it("is already relative when the path has no leading directory", () => {
    expect(sessionTildePath(".codex/sessions/2026/08/20/rollout-a.jsonl")).toBe(
      ".codex/sessions/2026/08/20/rollout-a.jsonl",
    );
  });
});
