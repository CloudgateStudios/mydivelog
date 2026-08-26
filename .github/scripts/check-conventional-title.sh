#!/usr/bin/env bash
#
# Validates that a subject line follows the Conventional Commits v1.0.0 spec.
# https://www.conventionalcommits.org/en/v1.0.0/
#
# Reads subjects as "label<TAB>subject" lines on stdin so that callers can check
# more than one (this repository squash-merges, and depending on the commit count
# either the PR title or the sole commit subject ends up on main).
#
# Writes GitHub Actions annotations and a step summary when running in CI, and
# plain text otherwise, so it can be run locally.

set -uo pipefail

TYPES='build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test'
PATTERN="^(${TYPES})(\([a-z0-9][a-z0-9._/-]*\))?!?: .+"
MAX_LEN=72

failed=0
errors=()

fail() {
  errors+=("$1")
  failed=1
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::error::$1"
  else
    echo "error: $1" >&2
  fi
}

check() {
  local label="$1" subject="$2" ok=1

  if [ -z "$subject" ]; then
    fail "${label} is empty."
    return
  fi

  if ! printf '%s' "$subject" | grep -qE "$PATTERN"; then
    fail "${label} does not follow Conventional Commits: \"${subject}\""
    return
  fi

  case "$subject" in
    *.) fail "${label} must not end with a period: \"${subject}\""; ok=0 ;;
  esac

  if [ "${#subject}" -gt "$MAX_LEN" ]; then
    fail "${label} is ${#subject} characters; keep it to ${MAX_LEN} or fewer."
    ok=0
  fi

  [ "$ok" -eq 1 ] && echo "ok  ${label}: ${subject}"
}

# `|| [ -n "$label" ]` so a final line with no trailing newline is still read.
while IFS=$'\t' read -r label subject || [ -n "${label:-}" ]; do
  [ -z "${label:-}" ] && continue
  check "$label" "${subject:-}"
  label=""
done

summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

if [ "$failed" -ne 0 ]; then
  {
    echo "## Conventional Commits check failed"
    echo
    for e in "${errors[@]}"; do echo "- ${e}"; done
    echo
    cat "$(dirname "$0")/conventional-commits-help.md"
  } >> "$summary"
  exit 1
fi

echo "## Conventional Commits check passed" >> "$summary"
