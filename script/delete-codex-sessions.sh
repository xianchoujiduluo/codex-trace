#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
    if ! command -v bash >/dev/null 2>&1; then
        printf 'Error: this script requires Bash.\n' >&2
        exit 1
    fi
    exec bash "$0" "$@"
fi

set -uo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
sessions_file="$script_dir/sessions.txt"
assume_yes=false

usage() {
    cat <<'EOF'
Usage: delete-codex-sessions.sh [--yes]

Reads session UUIDs from sessions.txt in the same directory and permanently
deletes them with `codex delete --force`. Blank lines, comments, and duplicate
UUIDs are ignored.

Options:
  -y, --yes  Skip the batch confirmation prompt
  -h, --help Show this help
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -y | --yes)
            assume_yes=true
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            printf 'Unknown option: %s\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
    shift
done

if ! command -v codex >/dev/null 2>&1; then
    printf 'Error: codex is not available in PATH.\n' >&2
    exit 1
fi

if [[ ! -f "$sessions_file" ]]; then
    printf 'Error: %s does not exist.\n' "$sessions_file" >&2
    printf 'Create it with one session UUID per line.\n' >&2
    exit 1
fi

declare -a session_ids=()
# macOS ships bash 3.2, which has no associative arrays. Dedupe against a
# newline-delimited string instead: `seen_ids` is always wrapped in newlines so
# a plain glob test can tell `abc` apart from `abcd`.
seen_ids=$'\n'
invalid_entries=0
line_number=0
uuid_pattern='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

while IFS= read -r line || [[ -n "$line" ]]; do
    ((line_number += 1))
    line=${line%$'\r'}
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"

    if [[ -z "$line" || "$line" == \#* ]]; then
        continue
    fi
    if [[ ! "$line" =~ $uuid_pattern ]]; then
        printf 'Invalid UUID on line %d: %s\n' "$line_number" "$line" >&2
        invalid_entries=1
        continue
    fi
    if [[ "$seen_ids" != *$'\n'"$line"$'\n'* ]]; then
        seen_ids="${seen_ids}${line}"$'\n'
        session_ids+=("$line")
    fi
done < "$sessions_file"

if ((invalid_entries != 0)); then
    printf 'No sessions were deleted. Fix sessions.txt and try again.\n' >&2
    exit 1
fi

session_count=${#session_ids[@]}
if ((session_count == 0)); then
    printf 'No session UUIDs found in %s.\n' "$sessions_file"
    exit 0
fi

if [[ "$assume_yes" != true ]]; then
    if [[ ! -t 0 ]]; then
        printf 'Confirmation requires a terminal. Re-run with --yes.\n' >&2
        exit 1
    fi
    printf 'Permanently delete %d Codex session(s)? This cannot be undone. [y/N] ' "$session_count"
    read -r answer
    if [[ "$answer" != "y" && "$answer" != "Y" && "$answer" != "yes" && "$answer" != "YES" ]]; then
        printf 'Cancelled.\n'
        exit 0
    fi
fi

deleted_count=0
declare -a failed_ids=()
for index in "${!session_ids[@]}"; do
    session_id=${session_ids[$index]}
    printf '[%d/%d] Deleting %s\n' "$((index + 1))" "$session_count" "$session_id"
    if codex delete --force "$session_id"; then
        ((deleted_count += 1))
    else
        failed_ids+=("$session_id")
    fi
done

printf '\nDeleted %d of %d session(s).\n' "$deleted_count" "$session_count"
if ((${#failed_ids[@]} > 0)); then
    printf 'Failed session UUIDs:\n' >&2
    printf '  %s\n' "${failed_ids[@]}" >&2
    exit 1
fi
