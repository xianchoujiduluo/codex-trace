# Changelog

All notable changes to codex-trace are documented here. Versions follow
[semantic versioning](https://semver.org/), and this file follows
[Keep a Changelog](https://keepachangelog.com/) conventions.

## [0.4.17] — 2026-09-16

### Added

- **Chat-style session view**. Transcripts render as a conversation — prompts in right-aligned
  bubbles, replies below them — with a compact tick rail on the right that jumps to any question
  in the session and keeps its place marked.
- **Per-message activity timeline**. Tool calls and reasoning blocks of a turn are interleaved in
  stream order under the reply that produced them, hidden until "Show activity" is pressed. Tool
  lines expand in place into the full command, diff and output, and the toggle scrolls the calls
  it just revealed into view.
- **Prompt in the turn detail header**. Opening a turn now shows the question it answers, so the
  reasoning, tool calls and final answer below it have their context on screen.

### Changed

- **Neutral deep gray palette**. The blue-violet theme is replaced with a muted one, and every
  remaining hard-coded tint now derives from a palette token.
- **Wider, unframed reading column**, looser spacing between messages, and friendlier tool
  summaries in the detail view.
- **Markdown renders in the transcript**, the same as it already did in the detail view, with
  single newlines preserved the way a chat client shows them.
- Reply headers lead with the timestamp followed by the turn's execution time in seconds.

### Fixed

- **Claude Code and pi sessions show as running again**. A turn was treated as finished as soon as
  its tool calls returned, but the model routinely reads those results and keeps going — so a live
  session, whose file sits on a tool result most of the time, never showed the running indicator.
  The provider's own stop reason now decides. Turn statuses, discovery and the activity tracker all
  use it, since the picker, sidebar and detail view read different ones.
- **Clicking a tool line in the transcript no longer jumps to the turn detail** — it expands the
  call where it is.
- Plaintext reasoning is displayed in the turn detail instead of being reported as encrypted.

[0.4.17]: https://github.com/xianchoujiduluo/codex-trace/releases/tag/v0.4.17

## [0.4.16] — 2026-09-13

### Added

- **Multi-provider session support: Claude Code and pi**. Browse Claude Code (`~/.claude/projects`)
  and pi (`~/.pi/agent/sessions`) session logs alongside Codex in the same interface. The session
  sidebar gains a provider filter (shown only when multiple agents are detected) and per-session
  agent badges; sessions from every agent render through the shared turn and tool-call model.
- **Provider abstraction layer**. A new provider layer detects each agent's log location from the
  filesystem path and dispatches parsing accordingly. Chat-style JSONL transcripts (Claude Code,
  pi) are normalised through a dedicated parser with tool-call pairing, token accounting, and
  byte-offset incremental refresh, so live tailing works for those sessions too. Codex parsing is
  unchanged.

[0.4.16]: https://github.com/xianchoujiduluo/codex-trace/releases/tag/v0.4.16

## [0.4.15] — 2026-09-02

### Added

- **Session source downloads**. Download the original JSONL session file directly from the
  sidebar, including the source filename and compressed rollout files.

### Fixed

- **Codex 0.152.1 collaboration traces**. Link current `SubAgentActivity` records to their worker
  sessions so spawned agent details are available in the parent session.

[0.4.15]: https://github.com/xianchoujiduluo/codex-trace/releases/tag/v0.4.15

## [0.4.14] — 2026-08-24

### Fixed

- **Session completion reconciliation**. Repair missed terminal SSE updates so completed turns
  no longer remain displayed as active, and avoid repeating unchanged turn data during polling.

### Added

- **Release result email**. Send the status of release and Docker jobs through the configured SMTP
  account after each release workflow run.

[0.4.14]: https://github.com/xianchoujiduluo/codex-trace/releases/tag/v0.4.14

## [0.4.13] — 2026-08-24

### Added

- **Scoped turn navigation and search**. Navigate replies from the turn list or detail view and
  search within the active session or turn.
- **Session status reconciliation**. Recheck the selected session through a lightweight endpoint
  so a missed SSE event cannot leave the detail view permanently marked Active.

[0.4.13]: https://github.com/starofkuku/codex-trace/releases/tag/v0.4.13

## [0.4.12] — 2026-08-20

### Added

- **Current Codex session titles**. Read `/rename` values from `session_index.jsonl`, otherwise use
  the latest user message, and keep both values current while sessions are active.
- **Directory session grouping**. Group sessions by working directory by default and allow users
  to switch between directory and activity-date views.

### Changed

- **Docker Codex home access**. Mount the complete Codex home read-only so containers can read both
  rollout files and rename metadata.

[0.4.12]: https://github.com/starofkuku/codex-trace/releases/tag/v0.4.12

## [0.4.11] — 2026-08-20

### Added

- **On-demand frontend updates**. Let Docker/web users download, validate, atomically install, and
  reload the latest single-file frontend from Settings without restarting the backend.
- **Frontend download proxy**. Support `CODEXTRACE_FRONTEND_PROXY` for both container startup and
  on-demand frontend downloads.
- **Version visibility**. Show the frontend version in the status bar and compare frontend and
  backend versions in Settings, including explicit mismatch and unavailable states.

[0.4.11]: https://github.com/starofkuku/codex-trace/releases/tag/v0.4.11

## [0.4.10] — 2026-08-20

### Changed

- **Activity-based session ordering**. Sort All, Active, Recent, and sidebar sessions by the
  timestamp of their latest valid rollout entry, regroup resumed sessions under their latest
  activity date, and update their position live as new entries arrive.

[0.4.10]: https://github.com/starofkuku/codex-trace/releases/tag/v0.4.10

## [0.4.9] — 2026-08-20

### Added

- **Recent-session filtering**. Add a Recent picker view showing the ten newest sessions,
  ordered by their recorded start time alongside All and Active.

[0.4.9]: https://github.com/starofkuku/codex-trace/releases/tag/v0.4.9

## [0.4.8] — 2026-08-19

### Added

- **Per-turn token accounting**. Derive each turn's usage from Codex cumulative snapshots and
  show non-cached input, cached input, output, reasoning, and Codex-compatible totals.
- **CLI-style structured tool traces**. Parse current `CommandExecution` and `FileChange` items,
  show action labels and durations, and render file edits with line counts and numbered diffs.

### Fixed

- **Terminal errors remain visible**. Preserve `task_complete.error` messages in turn previews
  and details instead of leaving failed turns blank.
- **Code Mode wrappers no longer obscure operations**. Prefer current structured tool items and
  keep the duplicate outer `exec` payload available under collapsed raw details.

[0.4.8]: https://github.com/starofkuku/codex-trace/releases/tag/v0.4.8

## [0.4.7] — 2026-08-18

### Added

- **Global active-session monitoring**. Track ongoing sessions across the entire sessions directory
  with filesystem notifications and a low-frequency metadata reconciliation pass.
- **Active-session filtering**. Switch the session picker between all sessions and sessions that
  are currently running without hiding sessions from the navigation sidebar.
- **Collapsible wider sidebar**. Expand the default session tree width and allow it to be collapsed
  to a compact toggle.

[0.4.7]: https://github.com/starofkuku/codex-trace/releases/tag/v0.4.7

## [0.4.6] — 2026-08-18

### Added

- **Large-session browsing**. Add paginated loading, incremental live updates, gzip responses,
  and parsed-session caching for large JSONL histories.
- **Rich Code Mode tool traces**. Expand current Codex `exec` calls into their nested commands,
  patches, and MCP operations instead of showing only the outer tool name.
- **Session file sizes**. Show each rollout file's on-disk size in the session sidebar.

[0.4.6]: https://github.com/starofkuku/codex-trace/releases/tag/v0.4.6

## [0.4.5] — 2026-08-18

### Fixed

- **Current Codex tool-call durations**. Parse the start and completion timestamps
  of current-format `custom_tool_call` entries so the UI can display their duration.

[0.4.5]: https://github.com/starofkuku/codex-trace/releases/tag/v0.4.5

## [0.4.4] — 2026-08-18

### Fixed

- **Docker frontend download startup hang**. Use bounded connection and transfer
  timeouts while retrying connection refusals, avoiding a curl retry behavior that
  could stall on GitHub Release redirects.

[0.4.4]: https://github.com/starofkuku/codex-trace/releases/tag/v0.4.4

## [0.4.3] — 2026-08-18

This release separates the Docker backend from the web frontend for faster,
independent deployments.

### Added

- **Single-file frontend releases**. Frontend changes now build one self-contained HTML
  file and publish it to the stable `frontend-latest` GitHub Release asset.

### Changed

- **Docker images are AMD64-only**. Release builds no longer emulate ARM64 through QEMU.
- **Docker downloads the frontend at startup**. The image contains only the Rust backend;
  `CODEXTRACE_FRONTEND_URL` selects the HTML file served by the existing HTTP server.
- **Docker cache is shared through Docker Hub**. Backend layers can now be reused across
  version tags instead of being isolated in tag-scoped GitHub Actions caches.

[0.4.3]: https://github.com/starofkuku/codex-trace/releases/tag/v0.4.3

## [0.4.2] — 2026-08-17

This patch restores release builds for the current Codex item-completion parser.

### Fixed

- **Compile current Codex item completions**. Nested `item_completed` objects now pass
  their `content` or `output` value into the shared text extractor without a Rust type
  mismatch.

[0.4.2]: https://github.com/starofkuku/codex-trace/releases/tag/v0.4.2

## [0.4.1] — 2026-08-17

This patch keeps session content visible with the current Codex rollout format.

### Fixed

- **Parse current Codex turn items**. User messages, assistant commentary/final answers,
  and non-empty reasoning summaries are now read from `item_completed` events.

[0.4.1]: https://github.com/starofkuku/codex-trace/releases/tag/v0.4.1

## [0.4.0] — 2026-06-28

A fresh app icon in codex green, a quieter macOS install, and a much lighter startup.
codex-trace no longer balloons memory while it scans your session history, and the macOS
bundle identifier no longer trips a system warning on launch.

### Added

- **Codex-green app icon**
  ([`1abd896`](https://github.com/PixelPaw-Labs/codex-trace/commit/1abd896)). The app
  icon's iris is recolored from orange to codex green (`#10a37f`) across every asset —
  the macOS `.icns`, the Windows `.ico` and Store tiles, and all PNG sizes — so the
  installed app, dock, and taskbar all show the new mark. The README header now carries
  the icon too.

### Fixed

- **Startup no longer spikes memory on large session histories**
  ([`20d85f4`](https://github.com/PixelPaw-Labs/codex-trace/commit/20d85f4)). The
  discovery scan used to load each session file fully into memory, so peak usage jumped
  to the size of your largest rollout file (often hundreds of MB) before settling. The
  scan now streams each file line by line — decompressing zstd on the fly — so memory
  during discovery is bounded to a single line regardless of session size.
- **macOS install no longer warns about the bundle identifier**
  ([`2b49ff9`](https://github.com/PixelPaw-Labs/codex-trace/commit/2b49ff9)). The bundle
  identifier ended in `.app`, which macOS flags as conflicting with the application
  bundle extension. It is now `com.codextrace.desktop`, so installing and launching the
  app is clean.

[0.4.0]: https://github.com/PixelPaw-Labs/codex-trace/releases/tag/v0.4.0

## [0.3.0] — 2026-06-28

Patch tool calls now read like a real code review, and the parser keeps pace with the
newest Codex CLI releases (v0.140.0 and v0.141.0). If you saw raw `*** Begin Patch`
text instead of a diff, or sessions from the latest Codex builds showed missing context
tools, unrecognized MCP tool calls, or spurious turns around `/import`, this release
addresses those.

### Added

- **`apply_patch` renders as a red/green diff**
  ([`426ea62`](https://github.com/PixelPaw-Labs/codex-trace/commit/426ea62)). An
  `apply_patch` tool call now shows a per-file, per-hunk diff with `+`/`-` markers,
  red/green line tinting, and word-level highlighting on the spans that actually
  changed — instead of the raw patch body. It falls back to the previous
  `patch_changes` / raw views when the input isn't a recognizable patch.

### Fixed

- **Tool calls from the latest Codex builds are classified correctly**
  ([`83cc23b`](https://github.com/PixelPaw-Labs/codex-trace/commit/83cc23b)). Codex
  v0.141.0 emits dynamic tool namespaces (MCP, connector, plugin) in `ThreadStart` /
  `task_started` events, so calls now arrive as qualified `mcp:server/tool_name` names
  or need a registry lookup. codex-trace reads the `dynamic_tools` registry and parses
  the qualified format, so these tools are recognized as MCP calls rather than mislabeled.
- **Context-budget tools are recognized**
  ([`c212d71`](https://github.com/PixelPaw-Labs/codex-trace/commit/c212d71)). Codex
  v0.140.0's `token_budget_context`, `context_remaining`, and `context_window` calls
  are now classified as context queries instead of falling through as unknown tools.
- **`/import` sessions parse cleanly**
  ([`3f73060`](https://github.com/PixelPaw-Labs/codex-trace/commit/3f73060)). Codex
  v0.140.0's `/import` command writes new lifecycle entries (e.g.
  `external_agent_imported`) before the first `task_started`, and v0.141.0 adds an
  `external_agent_import_result` response item. These are now handled explicitly, so
  imported-agent context no longer produces spurious synthetic turns or corrupts the
  turn it sits in.
- **IPC commands are granted explicitly in the ACL**
  ([`7e330bd`](https://github.com/PixelPaw-Labs/codex-trace/commit/7e330bd)). The app
  previously relied on Tauri implicitly permitting its own commands. Each command is now
  granted through an explicit permission set, with a regression test that cross-checks
  the handlers against the ACL in both directions — closing a path where a wired-up
  command could fail at runtime with "Command not allowed by ACL".

## [0.2.0] — 2026-06-16

A readability upgrade for the turn view plus a sweep of parser compatibility with the
latest Codex CLI releases (v0.132.0 through v0.139.0). If your sessions had blank final
answers, missing memory notes, or tool calls that looked corrupted on newer Codex
builds, this release fixes those — and the assistant's commentary now reads inline,
in order, alongside the tool calls it interleaves with.

### Added

- **Assistant commentary renders inline**
  ([`20d48f4`](https://github.com/PixelPaw-Labs/codex-trace/commit/20d48f4)). The
  assistant's prose is now a first-class timeline item ("Complementary") shown expanded
  by default, so a turn reads commentary → tool call → commentary → … → final answer top
  to bottom instead of leaving the text as loose lines above a tool box.
- **Image file paths from generated images**
  ([`1deb184`](https://github.com/PixelPaw-Labs/codex-trace/commit/1deb184)). Codex
  v0.138.0 attaches a `file_path` to image-generation results; codex-trace now surfaces
  it so you can see where a generated image landed on disk.
- **Archived-session awareness**
  ([`fcc8bc4`](https://github.com/PixelPaw-Labs/codex-trace/commit/fcc8bc4)). Sessions
  archived or unarchived via Codex v0.136.0's `codex archive` / `/archive` are now
  tracked, so archived runs are recognized rather than shown as ordinary sessions.

### Fixed

- **Raw command output no longer corrupts tool-call details**
  ([`6850c30`](https://github.com/PixelPaw-Labs/codex-trace/commit/6850c30)). On Codex
  v0.133.0, exec output is kept verbatim; phrases like "exit code: 1" inside real output
  were being mistaken for metadata. Exec metadata is now read only from the structured
  `Output:` marker, so a compiler or test log can no longer fake an exit code or
  duration.
- **Tool calls with structured arguments are no longer dropped**
  ([`f081fd0`](https://github.com/PixelPaw-Labs/codex-trace/commit/f081fd0)). Codex
  v0.139.0 can emit `function_call` arguments as a JSON object rather than a string;
  those calls now parse and display instead of showing up empty.
- **Final answers from `--output-schema` runs now display**
  ([`26f1874`](https://github.com/PixelPaw-Labs/codex-trace/commit/26f1874)). Codex
  v0.132.0 `structured_output` / `message` response items were silently skipped, leaving
  the final answer blank; they're now shown.
- **Versioned memory summaries are parsed again**
  ([`947f248`](https://github.com/PixelPaw-Labs/codex-trace/commit/947f248)). Codex
  v0.132.0 made `turn_context` memories versioned objects instead of plain strings,
  which dropped them from the view; both forms are now handled.
- **Agent-interrupt events are recognized under their new name**
  ([`b9f9bd1`](https://github.com/PixelPaw-Labs/codex-trace/commit/b9f9bd1)). Codex
  v0.139.0 renamed `close_agent` to `interrupt_agent`; both names are now classified
  correctly, so multi-agent runs keep displaying these events.

### Changed

- **Fonts aligned with claude-code-trace**
  ([`20d48f4`](https://github.com/PixelPaw-Labs/codex-trace/commit/20d48f4)). Detail-view
  text now uses fixed `px` sizing (13px prose) instead of `rem`, so type no longer
  rescales with browser/OS root font settings.

[0.3.0]: https://github.com/PixelPaw-Labs/codex-trace/releases/tag/v0.3.0
[0.2.0]: https://github.com/PixelPaw-Labs/codex-trace/releases/tag/v0.2.0

## [0.1.0] — 2026-06-08

The first release of Codex Trace — a desktop app for browsing and inspecting your
local Codex CLI sessions. Point it at `~/.codex/sessions` and it parses the rollout
JSONL files into a date-grouped session list and a per-session detail view, so you can
read a run turn-by-turn instead of scrolling raw logs.

### Added

- **Session browser and detail view.** Sessions are discovered from
  `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, grouped by date in the sidebar, and
  opened into a turn-by-turn detail view. Tool calls render inline in chronological
  order, each with an inline summary after the call name so you can skim a run at a
  glance ([#100](https://github.com/PixelPaw-Labs/codex-trace/pull/100)).
- **Broad Codex CLI version coverage.** The parser understands rollout formats across
  many Codex releases — goal lifecycle events
  ([#73](https://github.com/PixelPaw-Labs/codex-trace/pull/73)), `UserInput` /
  `ThreadSettings` items ([#87](https://github.com/PixelPaw-Labs/codex-trace/pull/87)),
  MCP `plugin_id` ([#74](https://github.com/PixelPaw-Labs/codex-trace/pull/74)),
  `trace_id` / `forked_from_thread_id` / compaction metadata
  ([#94](https://github.com/PixelPaw-Labs/codex-trace/pull/94)), memory context from
  `turn_context` ([#95](https://github.com/PixelPaw-Labs/codex-trace/pull/95)),
  `shell_hook_output` events
  ([#113](https://github.com/PixelPaw-Labs/codex-trace/pull/113)), and subagent
  identity fields ([#114](https://github.com/PixelPaw-Labs/codex-trace/pull/114)).
- **Headless / Docker mode.** The app can run without a desktop WebView, making it
  usable on servers and in containers.
- **macOS app bundle installer.** Installing on macOS now produces a proper `.app`
  bundle rather than a bare binary
  ([#99](https://github.com/PixelPaw-Labs/codex-trace/pull/99)).
- **`cut-release` skill.** A project-local Claude Code skill that automates cutting,
  tagging, and publishing a release end-to-end.

### Fixed

- **Compressed rollouts are now readable.** zstd-compressed rollout files (Codex
  v0.137.0) are transparently decompressed instead of failing to parse
  ([#109](https://github.com/PixelPaw-Labs/codex-trace/pull/109)).
- **MCP tool calls resolve correctly.** Tool calls are resolved from `tool_id` in
  v0.130.0 sessions ([#44](https://github.com/PixelPaw-Labs/codex-trace/pull/44)) and
  `mcp_tool_call` turn items from v0.129.0 are handled
  ([#39](https://github.com/PixelPaw-Labs/codex-trace/pull/39)).
- **Image-generation calls are classified correctly** rather than showing as a generic
  tool call ([#112](https://github.com/PixelPaw-Labs/codex-trace/pull/112)).
- **Forward-compatibility guards.** Hidden spawn-agent metadata
  ([#111](https://github.com/PixelPaw-Labs/codex-trace/pull/111)) and `assign_task` /
  `followup_task` items
  ([#108](https://github.com/PixelPaw-Labs/codex-trace/pull/108)) from newer Codex
  builds are now recognised instead of silently dropped.

### Performance

- **No more full session-list streaming on every file-system event** — the session list
  updates incrementally instead of being re-sent on each change.
- **WebKit and Xvfb are skipped in headless/Docker mode**, cutting startup cost and
  dependencies where no GUI is needed.

[0.1.0]: https://github.com/PixelPaw-Labs/codex-trace/releases/tag/v0.1.0
