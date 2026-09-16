#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM

mkdir -p "$test_dir/bin" "$test_dir/run"
cp "$repo_dir/script/delete-codex-sessions.sh" "$test_dir/run/delete-codex-sessions.sh"

cat > "$test_dir/bin/codex" <<'EOF'
#!/usr/bin/env bash
set -u
printf '%s\n' "$*" >> "${MOCK_CODEX_LOG:?}"
if [[ "${3:-}" == "${MOCK_FAIL_ID:-}" ]]; then
    exit 1
fi
EOF
chmod +x "$test_dir/bin/codex"

id_one=01900000-0000-7000-8000-000000000001
id_two=01900000-0000-7000-8000-000000000002
printf '# sessions to delete\n%s\n\n%s\n%s\n' "$id_one" "$id_one" "$id_two" \
    > "$test_dir/run/sessions.txt"

PATH="$test_dir/bin:$PATH" MOCK_CODEX_LOG="$test_dir/codex.log" \
    sh "$test_dir/run/delete-codex-sessions.sh" --yes

[[ $(wc -l < "$test_dir/codex.log") -eq 2 ]]
grep -Fxq "delete --force $id_one" "$test_dir/codex.log"
grep -Fxq "delete --force $id_two" "$test_dir/codex.log"

printf 'not-a-uuid\n' > "$test_dir/run/sessions.txt"
: > "$test_dir/codex.log"
if PATH="$test_dir/bin:$PATH" MOCK_CODEX_LOG="$test_dir/codex.log" \
    "$test_dir/run/delete-codex-sessions.sh" --yes; then
    printf 'Invalid input was accepted.\n' >&2
    exit 1
fi
[[ ! -s "$test_dir/codex.log" ]]

printf '%s\n%s\n' "$id_one" "$id_two" > "$test_dir/run/sessions.txt"
: > "$test_dir/codex.log"
if PATH="$test_dir/bin:$PATH" MOCK_CODEX_LOG="$test_dir/codex.log" MOCK_FAIL_ID="$id_one" \
    "$test_dir/run/delete-codex-sessions.sh" --yes; then
    printf 'A failed deletion did not produce a failing exit status.\n' >&2
    exit 1
fi
[[ $(wc -l < "$test_dir/codex.log") -eq 2 ]]
