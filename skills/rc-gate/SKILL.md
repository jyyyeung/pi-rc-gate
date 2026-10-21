---
name: rc-gate
description: Exit-code honesty and verification-before-claiming for agent-driven shells. Use when a bash command triggers a pi-rc-gate warning, when writing push/commit loops or scripted git operations, or before reporting any command as successful.
---

# rc-gate skill

## When this applies

You ran (or are about to run) a command whose failure can silently vanish:
piped git verbs, `|| true` swallows, late `$?` reads. Or you are about to
claim "done / green / pushed" based on a command you ran. False-green claims
are the most expensive agent failure class: nobody re-checks a reported
success.

## Protocol

1. **Capture rc immediately, before any other statement:**
   ```bash
   git push -q origin main; rc=$?; echo "push rc=$rc"
   [ "$rc" -eq 0 ] || { echo FAILED; return 1; }
   ```
   Between the command and `$?` there must be NOTHING — one `echo` in
   between and `$?` is the echo's status (0).
2. **Never pipe a state-changing git verb** into tail/head/grep — the
   pipeline's exit code is the consumer's. Show output after, or redirect to
   a file. Deliberate pipe (output truly irrelevant)? Add a trailing
   `# ok-piped-git` comment.
3. **Never `|| true` a push/commit/merge.** If the loop must continue,
   capture rc, record the failure, fail the loop at the end.
4. **Verify claimed effects on disk before claiming them:**
   - pushed? `git ls-remote origin <ref>` shows the SHA
   - committed? `git log --oneline -1` shows it
   - file written? read it back / check size
   Child-agent or subprocess prose ("done, tests pass") is NOT evidence —
   re-run the claim's check yourself.
5. **A rc-gate WARN is pre-emptive information**, not an obstacle: rewrite
   the command per (1) instead of adding an escape comment.

## Why warn-level, not block

Pipes and `||` are usually legitimate; only the state-changing-verb
combination lies. The warning arrives before the agent reports results —
that timing, not enforcement, is what breaks the habit.
