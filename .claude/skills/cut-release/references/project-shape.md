# Project Shape — `codex-trace`

The skill-specific facts the phase files rely on. For everything that's already in the
codebase, this file points at the source of truth rather than repeating it.

## Read these first if you don't know the codebase

- `AGENTS.md` (with `CLAUDE.md` symlinked to it) — toolchain commands (`npm run check`,
  `oxfmt`, `oxlint`, etc.) and the "format + lint + test before committing" rule.
- `.claude/hooks/pre-commit.sh` — header comments describe exactly what the hook checks
  (format, lint, tsc, Rust fmt/clippy) and how the per-session test-reflection flag
  bypass works.
- `.claude/settings.json` — the `Bash(*git commit*)` matcher that wires the hook into
  `git commit` calls.

## Version-bearing files (skill-specific rule)

Four files must agree on the next-version string. Nothing in the codebase enforces this
sync — the skill does.

| File                        | Owns                                 | Bumps with                     |
| --------------------------- | ------------------------------------ | ------------------------------ |
| `package.json` (root)       | Node/TS workspace + binary entry     | the Rust crates (lockstep)     |
| `parser/Cargo.toml`         | the `codex-trace-parser` crate       | root `package.json` (lockstep) |
| `src-tauri/Cargo.toml`      | the `codex-trace` app crate          | root `package.json` (lockstep) |
| `src-tauri/tauri.conf.json` | Tauri bundle filenames + app version | the app crate (lockstep)       |

All four move together because the desktop binary the user installs is built from the
workspace — `tauri.conf.json`'s `version` field is what `tauri-action` templates into the
released artifact filenames (`Codex.Trace_<version>_*.dmg`, etc., from the `productName`
"Codex Trace"). Missing `tauri.conf.json` silently ships a release whose artifacts are
stamped with the previous version; missing `parser/Cargo.toml` leaves the published
parser crate version behind (it is now consumable from other projects, so its version is
part of the public surface).

There is currently no separate sub-package (TUI or otherwise) with its own version
manifest. If a versioned manifest is ever introduced (e.g. a `pyproject.toml` or a nested
`package.json`), add it to the lockstep set and update the skill's Phase 3 step.

## Lockfile regen after a version bump

The lockfiles embed the local workspace's version, so they have to be regenerated after
editing version files — `npm run check` won't fix this on its own. Run:

```bash
npm install --package-lock-only   # → package-lock.json
cargo check --offline             # → Cargo.lock (workspace root)
```

`--package-lock-only` skips the full reinstall (nothing in `node_modules` needs to
change) and `--offline` skips the registry round-trip — only the local crates' version
moved. The lockfile is shared by the whole workspace and lives at the repo root.

## Release pipeline (delegated to CI)

`.github/workflows/release.yml` is the source of truth. Its job graph for `v*` tag
pushes:

1. `guard` — refuses to run if a non-draft GitHub release for the tag already exists.
   This is the duplicate-release defence-in-depth complement to the skill's Phase 1
   preflight; if a stale tag was pushed, the CI aborts before any artifact upload.
2. `notes` — slices `CHANGELOG.md` for the version's section and exposes it as a
   workflow output. Fails if the heading isn't in the exact `## [X.Y.Z] — YYYY-MM-DD`
   format.
3. `prepare-release` — creates the draft release with `gh` before any build starts, so
   each `tauri-action` run takes its "existing release, upload bundles" path rather than
   its create path. See the comment on the job for why: from v0.4.18 the action's own
   creation step failed with `Resource not accessible by integration` even though the
   token held `contents: write` and the action commit had not changed since the last
   working release. Preparing the draft up front sidesteps that entirely.
4. `build-macos` / `build-linux` / `build-windows` — three parallel `tauri-action` runs
   attaching platform artifacts to the draft prepared above.
5. `publish` — flips the draft to public and marks it latest.

`workflow_dispatch` mode (manual run, with a `version` input) is the artifact-free
path: the `manual-release` job runs `notes` then creates the `vX.Y.Z` tag and a
published, latest GitHub release whose body is the CHANGELOG section — but it builds
**no** desktop binaries. It refuses to overwrite an existing release for the version.
Use it to bootstrap a release (e.g. the first tag) or to publish a notes-only release;
use a `v*` tag push when you want the full macOS / Linux / Windows artifact build.

If the pipeline changes, edit the workflow and update Phase 7's narrative, not this
file.

## GitHub repo identity

Read once with `git remote get-url origin`; the URL template for commits and releases
follows from there:

- Commit: `<repo-url>/commit/<sha>`
- Release: `<repo-url>/releases/tag/v<X.Y.Z>`

The CHANGELOG template (`changelog-template.md`) hardcodes `PixelPaw-Labs/codex-trace`
in the link format. If the repo moves, update that file once.
