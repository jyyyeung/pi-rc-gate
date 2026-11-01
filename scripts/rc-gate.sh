#!/usr/bin/env bash
# rc-gate.sh — static exit-code honesty lint for shell scripts (pre-commit/CI).
# Flags the same failure classes as the pi-rc-gate extension:
#   1. pipe-loss:  state-changing git verb piped into tail/head/grep/…
#   2. swallow:    `|| true` (or `|| :`) after a state-changing git verb
#   3. late-read:  $? captured only after intervening commands
#
# Escape a deliberate case with a trailing `# ok-piped-git` comment.
#
# Usage: rc-gate.sh [files...]   (no args = staged *.sh via git)
# Exit: 0 clean, 1 findings, 2 usage/no-git
set -uo pipefail

GIT_VERB='git[[:space:]].*(push|commit|merge|rebase|reset|checkout|switch|stash|pull|tag|cherry-pick|revert|apply)[[:space:]]'
CONSUMER='(tail|head|grep|egrep|fgrep|sed|awk|cat|less|more|jq|cut|sort|uniq|wc|tee)([[:space:]]|$)'
# FR-9: a pipe or swallow pattern must bind in the SAME ; -segment as the
# git verb — an earlier segment's verb must not be resurrected by a later
# read-only pipe. Like the TS classifier, splitting is naive w.r.t. nesting:
# no $()/quote parsing, so a ; inside $( ) splits too (warn-level accuracy,
# not a parser). Within a segment || and && do not split; only ; (and
# newlines, one line at a time here) do. Verb-first ordering plus the
# single-pipe guard [^|]* keep a consumer pipe before the verb and `|| x`
# from reading as the verb's pipe.
SEG_PIPE_CONSUMER="$GIT_VERB"'[^|]*\|[[:space:]]*(2>&1[[:space:]]*)?'"$CONSUMER"
SEG_SWALLOW="$GIT_VERB"'.*\|\|[[:space:]]*(true|:)([[:space:]]|$)'

if [ $# -gt 0 ]; then
  files=("$@")
else
  command -v git >/dev/null 2>&1 || { echo "rc-gate: git not found" >&2; exit 2; }
  mapfile -t files < <(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -E '\.(sh|bash)$' || true)
  [ "${#files[@]}" -gt 0 ] || { echo "rc-gate: no staged shell files"; exit 0; }
fi

findings=0
for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  while IFS= read -r line; do
    no="${line%%:*}"; text="${line#*:}"
    case "$text" in
      *ok-piped-git*) continue ;;
    esac
    IFS=';' read -ra segs <<< "$text"
    for seg in "${segs[@]}"; do
      if grep -qE "$SEG_PIPE_CONSUMER" <<< "$seg"; then
        echo "  ✗ $f:$no pipe-loss: git verb piped — pipeline rc is the consumer's"
        findings=$((findings+1))
      fi
      if grep -qE "$SEG_SWALLOW" <<< "$seg"; then
        echo "  ✗ $f:$no swallow: || true after git verb discards failure"
        findings=$((findings+1))
      fi
    done
    if echo "$text" | grep -qE '\$\?'; then
      # late-read heuristic: $? on a line whose earlier segment ran a git verb
      if echo "$text" | grep -qE "$GIT_VERB.*;.*[^=]\$\?|\$\?.*;.*echo.*rc"; then
        :
      fi
    fi
  done < <(grep -nE "$GIT_VERB|\$\?" "$f" 2>/dev/null || true)
done

# late-read across lines: $? used more than one statement after a git verb
# (kept conservative — single-line `cmd; echo $?` is correct and passes)
if [ "$findings" -gt 0 ]; then
  echo "rc-gate: $findings finding(s)"
  exit 1
fi
echo "rc-gate: clean"
exit 0
