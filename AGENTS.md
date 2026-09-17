# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Codex Trace

OpenAI Codex CLI session log viewer. Rust + Tauri v2 backend, React 19 frontend, reads
`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and renders them as browsable turns.
Runs as a desktop app, a browser viewer against the local HTTP server, or headless in Docker.

`CLAUDE.md` is a symlink to this file (`AGENTS.md`); edit this file only.

## Commands

```bash
# Dev
npm run dev              # Vite dev server (frontend only)
npm run tauri dev        # Full Tauri desktop app
npm run dev:web          # Web mode = `tauri dev -- -- --web` (opens browser)

# Lint
npx oxlint              # JS/TS lint
cargo clippy --workspace --all-targets  # Rust lint

# Format
npx oxfmt               # JS/TS format (npm run fmt also formats Rust)
cargo fmt --all         # Rust format

# Test
npx vitest run                                     # all frontend tests
npx vitest run src/lib/minimap.test.ts             # one file
npx vitest run -t "some test name"                 # one test by name
cargo test --workspace                             # all Rust tests (both crates)
cargo test -p codex-trace-parser                   # just the parser crate
cargo test -p codex-trace-parser turn::            # filter (tests are inline `mod tests`)
cargo test --workspace acl                         # integration test in src-tauri/tests/
sh script/docker-entrypoint.test.sh                # shell tests (run by CI, not by `npm run check`)

# Type check
npx tsc --noEmit

# All at once
npm run check            # tsc + oxlint + oxfmt --check + clippy + cargo fmt --check + vitest + cargo test
```

### Checks before committing

After every code change (src, tests, config that affects build), add tests for the change, then run:

```bash
npx oxfmt && npx oxlint && npx tsc --noEmit && cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
```

Nothing enforces the command above at commit time — `.claude/settings.json` declares no hooks,
so it is on you to run it before opening a commit.

`.oxlintrc.json` bans direct imports of `@tauri-apps/api/core`, `@tauri-apps/api/event`, and
`@tauri-apps/plugin-opener` outside `src/lib/{invoke,listen,openUrl}.ts` (that is how the dual
transport and the `isTauri` guard stay enforced), and bans the default `react` import
(react-jsx transform — use named imports).

## Architecture

- **Workspace:** two Rust crates under one Cargo workspace, plus the frontend
  - `parser/` → `codex-trace-parser`: session-log parsing, no Tauri dependency
  - `src-tauri/` → `codex-trace`: the Tauri app and axum server
  - Run `cargo` commands with `--workspace` (or `-p <crate>`) from the repo root. The
    shared `Cargo.lock` and the build output (`target/`) both live at the root, not in
    `src-tauri/`.
- **Backend:** Rust + Tauri v2 + axum HTTP server (port 11424)
- **Frontend:** React 19 + TypeScript + Vite
- **Sessions:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`

### Multi-provider sessions (critical boundary)

Sessions from multiple coding agents are normalised into the same CodexTurn/ToolCall
model and tagged with a `provider` id (`"codex" | "claude" | "pi"`):

- `parser/src/provider.rs` — `Provider` enum, per-agent log roots
  (Codex `~/.codex/sessions`, Claude Code `~/.claude/projects`, pi `~/.pi/agent/sessions`),
  path-based detection, cross-provider discovery merge
- `parser/src/chat.rs` — generic "chat-style" JSONL engine (adapters turn raw
  lines into `ChatEvent`s; `ChatSessionBuilder` emits the shared turn model; byte-offset
  incremental refresh) used by Claude Code and pi; Codex keeps its native pipeline
- `parse_session` / `SessionHandle` in `parser/src/session.rs` dispatch by detected provider;
  `AppState` carries injectable `chat_roots` (tests pass `Vec::new()` to stay isolated
  from the machine's real agent homes)
- Adding a new agent: implement a `ChatAdapter` + scanner in `chat.rs` (or a native parser),
  register it in `Provider`/`default_chat_roots`, extend the UI `ProviderFilter`

### Dual transport (critical boundary)

Every backend command is reachable two ways, selected at runtime by `src/lib/isTauri.ts`:
desktop apps go through Tauri IPC; web/browser mode goes through axum HTTP. Adding a new
backend command means touching **all four** places or web mode breaks:

1. `src-tauri/src/commands/{picker,session,settings}.rs` — command implementation
2. `src-tauri/src/lib.rs` — register in `generate_handler![...]`
3. `src-tauri/src/http_api.rs` — axum route
4. `src/lib/invoke.ts` — add to the `routes` map (command name → HTTP path/body)

Request/response shapes live in `shared/types.ts` and must match the Rust serde structs.

A fifth place is required for **IPC-only** commands: the Tauri ACL. Each `generate_handler!`
entry needs a matching `commands.allow` entry in `src-tauri/permissions/default.toml`, listed
in the `[default]` permission set, which `src-tauri/capabilities/default.json` references.
`src-tauri/tests/acl_consistency.rs` checks this in both directions (missing and stale grants)
inside a normal `cargo test` run. Commands that are HTTP-only (e.g. `update_frontend`, exposed
as `POST /api/frontend/update` from `http_api.rs`) show up in the `invoke.ts` routes map without
being registered as Tauri handlers.

### Runtime modes (backend entry point)

`src-tauri/src/lib.rs` parses CLI flags from `std::env::args()`:

- no flags → desktop app (Tauri window + HTTP server, `tauri-plugin-single-instance` active)
- `--web` → desktop process that opens `http://localhost:1420` in the browser
- `--headless` → skip Tauri/WebKit entirely and run only the axum server (`start_http_server_headless`);
  this exists because Tauri unconditionally spawns WebKitWebProcess/WebKitNetworkProcess, which
  dominated CPU in Docker
- `--no-open` → suppress the browser launch

`bin/codex-trace.mjs` is the published `codex-trace` CLI wrapper (chooses `--app`/`--web`, checks
ports before launching).

### Key files

- `parser/` — the JSONL parsing pipeline, a standalone crate (`codex-trace-parser`) with
  no Tauri dependency, so other tools can depend on it directly
  - `src/entry.rs` — raw line parsing, format detection
  - `src/discover.rs` — session discovery + metadata scan
  - `src/session.rs` — full session parse (+ pagination direction)
  - `src/turn.rs` — turn boundary detection (new + old format)
  - `src/toolcall.rs` — tool call classification by end event
  - `src/compression.rs` — transparent zstd-compressed rollout reading
  - `src/cache.rs` — session metadata cache (mtime-keyed)
  - `src/activity.rs` — session activity tracking / path collection
  - `src/ongoing.rs` — ongoing-session detection
  - `src/redact.rs` — display-time secret redaction for exec commands
  - `src/spawn.rs` — collaboration agent spawn parsing
- `src-tauri/src/http_api.rs` — axum routes (port 11424) + SSE `/api/events` for live tailing,
  static `ServeDir`, frontend self-update (`update_frontend_html`, env-configurable URL/proxy)
- `src-tauri/src/commands/` — Tauri IPC commands (picker, session, settings)
- `src-tauri/src/state.rs` — shared app state (caches, broadcast channels)
- `src-tauri/src/watcher.rs` — notify-based file watching feeding the SSE stream
- `src-tauri/src/settings.rs` — persisted settings (sessions_dir override) in the OS config dir
- `src/App.tsx` — 3-view state machine (picker → list → detail)
- `src/components/SidebarTree.tsx` — CRITICAL: date-grouped JSONL folder structure
- `shared/types.ts` — TypeScript types (must match Rust structs)
- `shared/` — code shared between web/desktop views: `diff.ts`, `format.ts`, `patch.ts`, `hooks/`

### Tests

Frontend tests are colocated as `*.test.ts`/`*.test.tsx` next to their source, run by vitest in
jsdom with `src/test/setup.ts` (stubs `scrollIntoView`/`scrollTo`). `vitest.config.ts` includes
`src/**` and `shared/**`. Rust tests are inline `mod tests` per module, plus
`src-tauri/tests/acl_consistency.rs` as a whole-repo guard.

### Modes & ports

- Desktop dev: `npm run tauri dev`; web dev: `npm run dev:web` (Tauri in `--web` mode)
- Frontend dev: 1420 · Backend HTTP: 11424 · Docker (headless web): 1422
- Web mode calls `API_BASE` = `http://127.0.0.1:11424` (override with `VITE_API_BASE`)
- `npm run build` emits a single self-contained HTML file (vite-plugin-singlefile),
  verified by `script/verify-single-file-build.mjs` — this is the `frontend-latest` artifact
- Docker mounts `~/.codex` read-only at `/home/app/.codex`; ports/host configured via
  `CODEXTRACE_HTTP_HOST`, `CODEXTRACE_HTTP_PORT`, `CODEXTRACE_STATIC_DIR`
  (also `CODEXTRACE_FRONTEND_URL`, `CODEXTRACE_FRONTEND_PROXY`, `CODEX_HOME_DIR`)

### JSONL format

Three `session_meta` variants (new ≥0.44/mid/oldest 2025-08). Turn boundary detection uses
`task_started`/`task_complete` for newer CLI; `user_message` boundaries for older.
Tool calls classified by **end event type**, not function name.
Rollout files may be zstd-compressed (`compression.rs` handles this transparently).

### Versions & files

- App version is duplicated in `package.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/tauri.conf.json` — keep all three in sync on version bumps. `package.json` is the
  source of truth at build time: `build/version.ts` feeds it into the `CODEX_TRACE_VERSION`
  define in `vite.config.ts`/`vitest.config.ts`.
- `CHANGELOG.md` follows Keep a Changelog; the release workflow extracts the `## [X.Y.Z]` section
  verbatim as the GitHub release body and fails the run if it is missing

## Release Workflow

When `$release-tag-push` is requested, first classify the staged changes:

- For frontend-only changes (the frontend source, tests, styles, or build files watched by
  `.github/workflows/frontend.yml`), run the required checks, commit, and push the current branch
  only. Do not bump the application version, update the release changelog, create a `v*` tag, or
  trigger the backend/Docker release. The `main` push publishes the `frontend-latest` HTML.
- If any backend, Docker, Tauri, backend contract, or versioned release workflow file changes,
  follow the normal release flow: update release metadata, create the next annotated semver tag,
  and push the branch followed by the tag.

CI wiring: `ci.yml` (PR + `main`) runs tsc/oxlint/oxfmt/vitest + single-file build + Docker
entrypoint tests + Rust fmt/clippy/test on macOS. `frontend.yml` publishes `frontend-latest` on
`main` pushes touching `src/**`, `shared/**`, or the frontend build files. `release.yml` runs on
`v*` tags: it refuses to re-release an already-published tag, then builds macOS/Linux/Windows
Tauri artifacts and the Docker Hub image, flips the draft release public, and emails the result.
The project-local `cut-release` skill automates the whole versioned flow; `gha-docker-release`
covers the Docker image build/publish path.
