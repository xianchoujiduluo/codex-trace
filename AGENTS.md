# Codex Trace

OpenAI Codex CLI session log viewer. Rust + Tauri v2 backend, React 19 frontend, reads
`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and renders them as browsable turns.
Runs as a desktop app, a browser viewer against the local HTTP server, or headless in Docker.

## Commands

```bash
# Dev
npm run dev              # Vite dev server
npm run tauri dev        # Full Tauri desktop app
npm run dev:web          # Web mode (opens browser)

# Lint
npx oxlint              # JS/TS lint
cargo clippy --manifest-path src-tauri/Cargo.toml  # Rust lint

# Format
npx oxfmt               # JS/TS format
cargo fmt --manifest-path src-tauri/Cargo.toml     # Rust format

# Test
npx vitest run           # Frontend tests
cargo test --manifest-path src-tauri/Cargo.toml    # Rust tests

# Type check
npx tsc --noEmit

# All at once
npm run check            # tsc + oxlint + oxfmt --check + clippy + cargo fmt --check + vitest + cargo test
```

## Rule

After every code change (src, tests, config that affects build), always add enough tests for the changes, then run lint, format, and test before committing:

```bash
npx oxfmt && npx oxlint && npx tsc --noEmit && cargo fmt --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings && cargo test --manifest-path src-tauri/Cargo.toml
```

## Release Workflow

When `$release-tag-push` is requested, first classify the staged changes:

- For frontend-only changes (the frontend source, tests, styles, or build files watched by
  `.github/workflows/frontend.yml`), run the required checks, commit, and push the current branch
  only. Do not bump the application version, update the release changelog, create a `v*` tag, or
  trigger the backend/Docker release. The `main` push publishes the `frontend-latest` HTML.
- If any backend, Docker, Tauri, backend contract, or versioned release workflow file changes,
  follow the normal release flow: update release metadata, create the next annotated semver tag,
  and push the branch followed by the tag.

## Architecture

- **Backend:** Rust + Tauri v2 + axum HTTP server (port 11424)
- **Frontend:** React 19 + TypeScript + Vite
- **Sessions:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`

### Multi-provider sessions (critical boundary)

Sessions from multiple coding agents are normalised into the same CodexTurn/ToolCall
model and tagged with a `provider` id (`"codex" | "claude" | "pi"`):

- `src-tauri/src/parser/provider.rs` — `Provider` enum, per-agent log roots
  (Codex `~/.codex/sessions`, Claude Code `~/.claude/projects`, pi `~/.pi/agent/sessions`),
  path-based detection, cross-provider discovery merge
- `src-tauri/src/parser/chat.rs` — generic "chat-style" JSONL engine (adapters turn raw
  lines into `ChatEvent`s; `ChatSessionBuilder` emits the shared turn model; byte-offset
  incremental refresh) used by Claude Code and pi; Codex keeps its native pipeline
- `parse_session` / `SessionHandle` in `parser/session.rs` dispatch by detected provider;
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

### Key files

- `src-tauri/src/parser/` — JSONL parsing pipeline
  - `entry.rs` — raw line parsing, format detection
  - `discover.rs` — session discovery + metadata scan
  - `session.rs` — full session parse
  - `turn.rs` — turn boundary detection (new + old format)
  - `toolcall.rs` — tool call classification by end event
  - `cache.rs` / `compression.rs` — parse cache + zstd compression
  - `ongoing.rs` — live-tail state for in-progress sessions
  - `redact.rs`, `spawn.rs`, `activity.rs` — redaction, collaboration/agent spawn links, activity
- `src-tauri/src/http_api.rs` — axum routes (port 11424) + SSE `/api/events` for live tailing
- `src-tauri/src/watcher.rs` — notify-based file watching feeding the SSE stream
- `src/App.tsx` — 3-view state machine (picker → list → detail)
- `src/components/SidebarTree.tsx` — CRITICAL: date-grouped JSONL folder structure
- `shared/types.ts` — TypeScript types (must match Rust structs)

### Modes & ports

- Desktop dev: `npm run tauri dev`; web dev: `npm run dev:web` (Tauri in `--web` mode)
- Frontend dev: 1420 · Backend HTTP: 11424 · Docker (headless web): 1422
- Web mode calls `API_BASE` = `http://127.0.0.1:11424` (override with `VITE_API_BASE`)
- `npm run build` emits a single self-contained HTML file (vite-plugin-singlefile),
  verified by `script/verify-single-file-build.mjs` — this is the `frontend-latest` artifact
- Docker mounts `~/.codex` read-only at `/home/app/.codex`; ports/host configured via
  `CODEXTRACE_HTTP_HOST`, `CODEXTRACE_HTTP_PORT`, `CODEXTRACE_STATIC_DIR` env vars

### JSONL format

Three `session_meta` variants (new/mid/oldest). Turn boundary detection uses
`task_started`/`task_complete` for newer CLI; `user_message` boundaries for older.
Tool calls classified by **end event type**, not function name.

### Versions & files

- App version is duplicated in `package.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/tauri.conf.json` — keep all three in sync on version bumps
- `CLAUDE.md` is a symlink to `AGENTS.md`; edit this file only
