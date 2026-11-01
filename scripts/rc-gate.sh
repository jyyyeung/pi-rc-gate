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
# Exit: 0 clean, 1 findings, 2 usage/no-git/no-such-file, 3 internal error
#
# Runs on bash 3.2 (stock macOS /bin/bash). Deliberate choices:
#   * no `mapfile` (bash 4), no associative arrays, no `read -d ''`
#   * arrays are length-checked before expansion — `set -u` + `"${a[@]}"` on an
#     empty array is an unbound-variable error in bash 3.2
#   * exit 3 is distinct from 1 — a broken linter must never be mistaken for a
#     dirty script, which is this tool's whole subject
# Filenames containing newlines are not supported (git --name-only is newline-
# delimited); use explicit args for those.
set -uo pipefail

command -v grep >/dev/null 2>&1 || { echo "rc-gate: internal error: grep not found" >&2; exit 3; }

# Read-only forms of otherwise state-changing verbs are exempt: a lost exit code
# on them cannot fake a green write. Keep in sync with src/patterns.ts.
#   git tag <listing flag>     git stash list|show     git apply --check|--stat|…
#   git commit|push --dry-run  git clean -n|--dry-run
GIT_VERB='git[[:space:]].*(push|commit|merge|rebase|reset|checkout|switch|stash|pull|tag|cherry-pick|revert|apply|clean|am|worktree|branch[[:space:]]+-[A-Za-z]*[Dd])[[:space:]]'
RO_TAIL='tag[[:space:]]*([|;&]|$)|tag[[:space:]]+(-l|-n[0-9]*|--list|--contains|--points-at|--merged|--no-merged|--column|--color|--format=|--sort=)|stash[[:space:]]+(list|show)([[:space:]]|$)|apply[[:space:]]+(-[^[:space:]]+[[:space:]]+)*--(check|stat|numstat|summary)([[:space:]]|$)|(commit|push)[[:space:]]+(-[^[:space:]]+[[:space:]]+)*--dry-run([[:space:]]|$)|clean[[:space:]]+(-[^[:space:]]+[[:space:]]+)*(-[A-Za-z]*n[A-Za-z]*|--dry-run)([[:space:]]|$)'
CONSUMER='(tail|head|grep|egrep|fgrep|sed|awk|cat|less|more|jq|cut|sort|uniq|wc|tee|[Ss]elect-[Oo]bject|[Ss]elect-[Ss]tring|select|sls|findstr|[Oo]ut-[Ss]tring|[Oo]ut-[Ff]ile|[Mm]easure-[Oo]bject)([[:space:]]|$)'
# FR-9: a pipe or swallow pattern binds only in the SAME ; -segment as the git
# verb, so an earlier segment's verb cannot be resurrected by a later read-only
# pipe. Splitting is naive w.r.t. nesting (no $()/quote parsing): warn-level
# accuracy, not a parser. Verb-first ordering plus the single-pipe guard [^|]*
# keep a consumer pipe before the verb from reading as the verb's pipe.
SEG_PIPE_CONSUMER="$GIT_VERB"'[^|]*\|[[:space:]]*(2>&1[[:space:]]*)?'"$CONSUMER"
SEG_SWALLOW="$GIT_VERB"'.*\|\|[[:space:]]*(true|:)([[:space:]]|$)'
IMMEDIATE_CAPTURE='^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=\$\?|^[[:space:]]*\[[[:space:]]*"?\$|^[[:space:]]*(if|while)'

FILES=""
if [ $# -gt 0 ]; then
  for f in "$@"; do
    [ -f "$f" ] || { echo "rc-gate: no such file: $f" >&2; exit 2; }
  done
  FILES=$(printf '%s\n' "$@")
else
  command -v git >/dev/null 2>&1 || { echo "rc-gate: git not found" >&2; exit 2; }
  FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -E '\.(sh|bash)$' || true)
  [ -n "$FILES" ] || { echo "rc-gate: no staged shell files"; exit 0; }
fi

findings=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$f" ] || continue
  lineno=0
  while IFS= read -r line; do
    lineno=${line%%:*}
    text=${line#*:}
    case "$text" in
      *ok-piped-git*) continue ;;
    esac
    segs=()
    IFS=';' read -ra segs <<< "$text"
    [ "${#segs[@]}" -gt 0 ] || continue

    # pass 1: pipe-loss / swallow, per segment (a read-only verb in one segment
    # must not excuse a state-changing verb in another)
    for seg in "${segs[@]}"; do
      echo "$seg" | grep -qE "$RO_TAIL" && continue
      if echo "$seg" | grep -qE "$SEG_PIPE_CONSUMER"; then
        echo "  ✗ $f:$lineno pipe-loss: git verb piped — pipeline rc is the consumer's"
        findings=$((findings+1))
      fi
      if echo "$seg" | grep -qE "$SEG_SWALLOW"; then
        echo "  ✗ $f:$lineno swallow: || true after git verb discards failure"
        findings=$((findings+1))
      fi
    done

    # pass 2: late-read — the segment immediately after the git verb must
    # capture $? itself; a $? read later holds some other command's status.
    if echo "$text" | grep -qE "$GIT_VERB" && echo "$text" | grep -qF '$?'; then
      # find the first verb segment, then judge the segment after it
      i=0
      verb_seg=0
      for seg in "${segs[@]}"; do
        i=$((i+1))
        if [ "$verb_seg" -eq 0 ] && echo "$seg" | grep -qE "$GIT_VERB"; then verb_seg=$i; fi
      done
      if [ "$verb_seg" -gt 0 ] && [ "$verb_seg" -lt "${#segs[@]}" ]; then
        i=0
        for seg in "${segs[@]}"; do
          i=$((i+1))
          [ "$i" -gt "$verb_seg" ] || continue
          if [ "$i" -eq $((verb_seg+1)) ] && echo "$seg" | grep -qE "$IMMEDIATE_CAPTURE"; then
            break
          fi
          if echo "$seg" | grep -qF '$?'; then
            echo "  ✗ $f:$lineno late-read: \$? read after an intervening command — it holds the LAST command's status"
            findings=$((findings+1))
            break
          fi
        done
      fi
    fi
  done < <(grep -nE "$GIT_VERB|\$\?" "$f" 2>/dev/null || true)
done < <(printf '%s\n' "$FILES")

if [ "$findings" -gt 0 ]; then
  echo "rc-gate: $findings finding(s)"
  exit 1
fi
echo "rc-gate: clean"
exit 0
