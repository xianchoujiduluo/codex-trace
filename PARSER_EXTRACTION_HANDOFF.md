# Parser extraction — handoff for parallel work

**Status:** changes are in the working tree of this repo, on branch
`refactor/extract-parser`. Nothing is committed and nothing is pushed.
`main` is untouched at `da1ffa8`.

**Author of these changes:** an agent working on the sibling `herdr` project.
This file exists so another agent can review, reconcile, and merge the work.

---

## 1. Why this change exists

`herdr` renders agent conversations in its web UI. Instead of reimplementing
session-log parsing, it wants to reuse this project's parser. That parser
already normalises Codex, Claude Code, and pi logs into one turn/tool-call
model, and it carries a large amount of hard-won version and edge-case
handling that would be expensive to duplicate.

For `herdr` to depend on the parser, the parser has to be its own crate.
Right now it is a private `mod` inside the `codex-trace` app crate, so it
cannot be consumed from outside.

**Goal:** make the parser a standalone, publishable crate with zero
dependency on Tauri, without changing the `codex-trace` binary's behaviour.

**Non-goal:** this change does not alter parsing logic, the HTTP API, the
frontend, or any user-visible output. The binary produced from `src-tauri`
should behave identically.

### How the consumer will use it

`herdr` will depend on it by git:

```toml
# in herdr's Cargo.toml
codex-trace-parser = { git = "https://github.com/xianchoujiduluo/codex-trace", branch = "main" }
```

Note on `branch = "main"`: Cargo locks a git dependency to a specific commit
in `Cargo.lock`, so day-to-day builds stay pinned. The dependency only moves
when the lockfile is re-resolved (`cargo update`, a fresh checkout, or a
dependency-version change). The practical implication is below in
"Convention going forward".

---

## 2. What changed

29 entries: 14 renames (9 pure moves, 5 moves with edits), 10 modified
files, 3 new files, 1 deletion.

### 2.1 Structural: parser becomes its own crate

| Before                                 | After                                         |
| -------------------------------------- | --------------------------------------------- |
| `src-tauri/src/parser/mod.rs`          | `parser/src/lib.rs`                           |
| `src-tauri/src/parser/*.rs` (13 files) | `parser/src/*.rs`                             |
| —                                      | `parser/Cargo.toml` (new)                     |
| —                                      | `Cargo.toml` at repo root (new workspace)     |
| `src-tauri/Cargo.toml` (no parser dep) | `codex-trace-parser = { path = "../parser" }` |
| `src-tauri/Cargo.lock`                 | `Cargo.lock` at repo root                     |

The 9 pure renames are file moves with no content change. The 5 renames
listed with `RM` in `git status` have edits; all of their edits are covered
below (all five appear in the §2.2 table except `turn.rs`, whose only change
is the mechanical path rewrite described in §2.3).

### 2.2 Edits that are more than a path rewrite

These are the changes worth reviewing carefully. Two were required by the
extraction; one fixes a pre-existing dead test; one is a lint fix that was
previously not being enforced.

| File                     | Change                                         | Why                                                                                                                                                                                                                                                                                      |
| ------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parser/src/cache.rs`    | Added `impl Default for SessionCache`          | Clippy's `new_without_default`. This lint did not run before because `mod parser` was not a crate target, so Clippy skipped it. Now that it is a crate, CI's `cargo clippy` sees it.                                                                                                     |
| `parser/src/discover.rs` | `pub(crate) fn apply_session_index` → `pub fn` | Called from `src-tauri/src/state.rs`. Crossing a crate boundary requires `pub`.                                                                                                                                                                                                          |
| `parser/src/entry.rs`    | Added `#[test]` to `parse_response_item`       | The function had no `#[test]` attribute and no callers, so it was dead code that Clippy reported as `dead_code` once the crate was built with `--all-targets`. It is clearly intended as a test; restoring the attribute is the minimal fix. **Worth confirming this reading is right.** |
| `parser/src/chat.rs`     | `write!(... "\n")` → `writeln!(...)`           | Clippy `write_with_newline`, in test code. Same reason as above.                                                                                                                                                                                                                         |
| `parser/src/turn.rs`     | 26 × `crate::parser::X` → `crate::X`           | Internal paths, mechanical.                                                                                                                                                                                                                                                              |

Everything else in the diff is `crate::parser::` → `codex_trace_parser::`
in `src-tauri`, plus manifest, Docker, and CI updates.

### 2.3 Path rewrites

- **Inside the parser crate:** `crate::parser::` → `crate::`. All 26
  occurrences are in `parser/src/turn.rs` (test modules referencing `entry`
  and `toolcall`). The crate root is now the parser itself.
- **Inside `src-tauri`:** `crate::parser::` → `codex_trace_parser::`, 23
  occurrences across `watcher.rs` (9), `state.rs` (6),
  `commands/session.rs` (5), `http_api.rs` (2), `commands/picker.rs` (1).
- `mod parser;` removed from `src-tauri/src/lib.rs`.

### 2.4 Build, container, and CI updates

These are easy to miss and each one broke the build when omitted:

| File                                  | Change                                                                                  | Why it was required                                                                                                                                                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cargo.toml` (new)                    | `[workspace] members = ["parser", "src-tauri"]`                                         | Cargo resolves a git dependency from the repo root, so the root manifest must declare its members.                                                                                                                                                |
| `Cargo.toml` (new)                    | `[profile.dev]` / `[profile.release]` moved here from `src-tauri/Cargo.toml`            | Cargo **ignores profile tables in non-root workspace members** and warns. Keeping them in `src-tauri` would silently drop the release profile (LTO, `opt-level = "s"`, `strip`). This is worth double-checking against your release expectations. |
| `src-tauri/Cargo.lock` → `Cargo.lock` | Moved to root                                                                           | A workspace has one lockfile, at the root.                                                                                                                                                                                                        |
| `Dockerfile`                          | Now copies `Cargo.toml`, `Cargo.lock`, `parser/`, `src-tauri/`                          | Previously only copied `src-tauri`; the build failed on the missing `../parser`.                                                                                                                                                                  |
| `.dockerignore`                       | Un-ignores `Cargo.toml`, `Cargo.lock`, `parser/`                                        | The file starts with `*` and re-includes paths explicitly, so the new paths had to be added or the Docker context would omit them.                                                                                                                |
| `.gitignore`                          | `src-tauri/target/` → `target/`                                                         | The workspace builds into a root `target/`, so the old entry no longer matched.                                                                                                                                                                   |
| `.github/workflows/ci.yml`            | `--manifest-path src-tauri/Cargo.toml` → workspace flags; `workspaces: src-tauri` → `.` | The manifest path still works but only covers one member. Now uses `cargo fmt --all`, `cargo clippy --workspace --all-targets`, `cargo test --workspace`.                                                                                         |

**Note on the CI change:** switching to `--all-targets` is what surfaced the
`cache.rs`, `entry.rs`, and `chat.rs` lints above. If you prefer, CI can stay
on the narrower `cargo clippy --workspace -- -D warnings` that the original
used, but then the parser crate will be linted less strictly than the rest.

### 2.5 Dependency pruning

The extracted crate needs far less than the app did. `parser/Cargo.toml`
declares only:

```toml
serde, serde_json, chrono, indexmap, regex, zstd, dirs
# dev: tempfile
```

`zstd` and `dirs` were easy to miss — `compression.rs` decompresses
`.jsonl.zst` files, and `session.rs` calls `dirs::home_dir()` for the default
sessions directory. Both were caught by the compiler after being omitted.

---

## 3. Verification performed

All of the following was run and passed on the working tree.

```bash
cargo fmt --all --check                                  # clean
cargo clippy -p codex-trace-parser --all-targets -- -D warnings   # clean
cargo test -p codex-trace-parser                         # 420 passed, 0 failed
cargo package -p codex-trace-parser --no-verify          # packages, 148 KB
docker build --target backend-builder .                  # full app builds (10m 41s)
```

The Docker build is the meaningful check for `src-tauri`, because it needs
WebKitGTK and dbus that are not installed on the machine where the change was
made. Building the app crate locally fails on those system libraries, not on
anything in this diff.

Additionally, a throwaway consumer crate was created with a path dependency on
`parser/`, and it successfully called
`codex_trace_parser::provider::Provider::detect_from_path(...)`. That confirms
the crate is consumable from outside, which is the whole point of the change.

### What was NOT verified

- **The `codex-trace` binary's runtime behaviour.** The Docker build proves it
  compiles and links; no session was loaded through the built binary to confirm
  identical output. If you want that assurance, run the container and load a
  known session on both sides of the change and compare the JSON.
- **The release profile actually applying.** The profile tables moved to the
  workspace root, which is correct per Cargo's rules, but no binary-size or
  LTO check was done.

---

## 4. Rework needed if this project is also being edited elsewhere

If another agent has modified `parser/` in the meantime, the moves will
conflict. The reconciliation is mechanical:

1. Take `git status` here to see the file list.
2. For any file present in both the other agent's changes and this work, merge
   the other agent's edits into the file at its **new** location
   (`parser/src/<name>.rs`).
3. Re-apply the five edits in §2.2 if they were lost in the merge. Each is
   small and the table above gives the exact change.
4. Re-run the verification commands in §3.

The one edit that is a judgement call rather than a pure fix is the
`#[test]` restore in `entry.rs` — check that it matches the intent there.

---

## 5. Convention going forward

Because `herdr` will follow `main`, a change to the parser's **public
interface** can break `herdr`'s build the next time its lockfile re-resolves.
Internal changes, docs, frontend work, and CI edits are harmless.

Practical rule: when changing a public item in `parser/`, update the call site
in `herdr` in the same breath. The public surface is what `src-tauri` reaches
for — `provider`, `discover`, `session`, `turn`, `toolcall`, `activity` — and
that set is visible by grepping `src-tauri` for `codex_trace_parser::`.

If that coupling ever becomes a problem, pinning
`rev = "<commit>"` in `herdr`'s manifest removes it at the cost of manual
upgrades.

---

## 6. Requested action

This work is **uncommitted**. Please review, and decide:

1. **Keep it** — commit on a branch, then merge. Suggested message:

   ```
   refactor: extract the session parser into its own crate

   The parser has no dependency on Tauri, so it does not need to live
   inside the app crate. Moving it to `codex-trace-parser` lets other
   tools consume the same turn and tool-call model instead of
   reimplementing it.

   The workspace root owns the lockfile and the release profile, since
   Cargo ignores profile tables in non-root members.
   ```

2. **Discard it** — everything is in the working tree, so:

   ```bash
   git checkout . && git clean -fd
   git checkout main
   git branch -D refactor/extract-parser
   ```

3. **Change it** — the items most likely to want adjustment are the
   `#[test]` restore in `entry.rs` and the `--all-targets` CI switch.

Once this lands and `main` is pushed, `herdr` can add the dependency and drop
its temporary HTTP coupling to the `codex-trace` container.
