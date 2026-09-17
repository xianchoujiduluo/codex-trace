# Phase 3 — Bump version files

Goal: bump every version-bearing file to `$NEXT_VERSION` and regenerate the lockfile.

Refer to `${CLAUDE_SKILL_DIR}/references/project-shape.md` for the rules on which files
move in lockstep.

## Step 3.1 — Bump root + both crates + Tauri config (lockstep)

Use the Edit tool with precise `old_string`/`new_string` (not sed):

- `package.json` — top-level `"version"` field
- `parser/Cargo.toml` — `[package].version` line
- `src-tauri/Cargo.toml` — `[package].version` line
- `src-tauri/tauri.conf.json` — top-level `"version"` field

All four must end up at `$NEXT_VERSION`. `tauri.conf.json` is the one `tauri-action`
reads when stamping artifact filenames at build time (`Codex.Trace_<version>_*.dmg`, etc.,
from the `productName` "Codex Trace"), and `parser/Cargo.toml` versions the crate other
projects depend on. Skipping either ships a release that disagrees with itself.

## Step 3.2 — No other sub-packages

The workspace has exactly the two crates above. If a versioned manifest is ever added
(e.g. a nested `package.json` or a `pyproject.toml`), bump it in lockstep and update this
step.

## Step 3.3 — Regenerate the lockfile

```bash
npm install --package-lock-only
cargo check --offline
```

These commands write the new local-workspace version into the lockfile, which is shared by
the workspace and lives at the repo root. Then verify the diff is small and only touches
version strings:

```bash
git diff --stat -- package.json parser/Cargo.toml src-tauri/Cargo.toml src-tauri/tauri.conf.json package-lock.json Cargo.lock
```

Expect roughly 7 files changed and around 7 insertions / 7 deletions. A large diff
suggests the lockfile was stale or has unrelated dep changes — investigate before
continuing.

Proceed to Phase 4.
