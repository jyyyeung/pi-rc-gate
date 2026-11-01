/**
 * pi-rc-gate — exit-code honesty for agent-driven shells.
 *
 * The failure class: an agent runs a state-changing command, the shell
 * reports failure, but the command's exit code never reaches the agent —
 * piped into tail/head (pipe returns the LAST command's status), swallowed
 * by `|| true`, or read too late after `$?` was clobbered. The agent then
 * reports "done, green" from prose instead of evidence. Every incident in
 * this family produces a false-green claim.
 */

/** Read-only `git tag` listing forms (FR-6): bare tag, -l/--list, -n[n],
 *  --contains/--points-at/--merged/--no-merged (value follows the flag),
 *  --format=/--sort= (value in the flag), --column, --color — these only
 *  list refs, so a lost exit code cannot fake a green write. A refname or
 *  a write flag (-a -s -u -m -F -f -d -D) after `tag` still matches.
 *  Interpolated as a negative lookahead after the `tag` verb in both
 *  STATE_CHANGING_GIT and SWALLOW_GIT. */
const READONLY_TAG_TAIL = String.raw`tag\b(?!\s*(?:$|[|;&])|\s+(?:-l\b|-n\d*\b|--list\b|--contains\b|--points-at\b|--merged\b|--no-merged\b|--column\b|--color\b|--(?:format|sort)=))`;

/** Read-only `git stash` forms (list/show): they only read, so a lost exit
 *  code cannot fake a green write. Bare `git stash` is the push shorthand and
 *  still counts as state-changing, so unlike the tag tail this lookahead does
 *  not exempt an empty tail. */
const READONLY_STASH_TAIL = String.raw`stash\b(?!\s+(?:list|show)\b)`;

/** Read-only `git apply` forms: --check/--stat/--numstat/--summary inspect a
 *  patch without touching the worktree. */
const READONLY_APPLY_TAIL = String.raw`apply\b(?!\s+(?:-\w+\s+)*--(?:check|stat|numstat|summary)\b)`;

/** Read-only `git commit`/`git push` dry runs: they report, they do not write.
 *  Only flags git actually supports are exempted — `git checkout --dry-run`
 *  does not exist, so it stays flagged: the command genuinely fails, which is
 *  exactly when its rc must not be lost. */
const READONLY_COMMIT_TAIL = String.raw`commit\b(?!\s+(?:-\w+\s+)*--dry-run\b)`;
const READONLY_PUSH_TAIL = String.raw`push\b(?!\s+(?:-\w+\s+)*--dry-run\b)`;

/** Read-only `git clean` forms (-n/--dry-run, in any short-flag cluster such as
 *  -nd). `git clean -fd | cat` destroying untracked work is a false-green
 *  classic, so the verb is in scope; the dry run is not. */
const READONLY_CLEAN_TAIL = String.raw`clean\b(?!\s+(?:-\w+\s+)*--dry-run\b)(?!\s+(?:-\w+\s+)*-\w*n\w*\b)`;

/** The verb alternation shared by every pattern below, so a read-only
 *  exemption can never drift between the pipe and the swallow check. */
const VERBS = [
  READONLY_PUSH_TAIL,
  READONLY_COMMIT_TAIL,
  String.raw`merge(?!-(?:base|ours|theirs|file))\b`,
  String.raw`rebase\b`,
  String.raw`reset\b`,
  String.raw`checkout\b`,
  String.raw`switch\b`,
  READONLY_STASH_TAIL,
  String.raw`pull\b`,
  READONLY_TAG_TAIL,
  String.raw`cherry-pick\b`,
  String.raw`revert\b`,
  READONLY_APPLY_TAIL,
  String.raw`am\b`,
  String.raw`worktree\s+(?:add|remove)\b`,
  String.raw`branch\s+-\w*[Dd]\b`,
  READONLY_CLEAN_TAIL,
].join("|");

/** State-changing git verbs whose failure MUST reach the caller. */
export const STATE_CHANGING_GIT = new RegExp(
  String.raw`\bgit\s+(?:-{1,2}[\w-]+(?:\s+"[^"]*"|\s+'[^']*'|\s+\S+)?\s+)*(?:${VERBS})`,
);

/** `|| true`/`|| :` swallowing one of the state-changing verbs (P2). */
const SWALLOW_GIT = new RegExp(
  String.raw`\bgit\s(?:[^|;&\n]|&(?!&))*(?:${VERBS})(?:[^|;&\n]|&(?!&))*\|\|\s*(?:true\b|:)`,
);

/** Pipeline consumers that turn the pipeline's rc into their own 0. The
 *  powershell aliases are included so the same gate works on Windows, where
 *  `git push | Select-Object -Last 5` hides the push's status just as
 *  `| tail -5` does. */
const CONSUMERS = String.raw`tail|head|grep|egrep|fgrep|sed|awk|cat|less|more|jq|cut|sort|uniq|wc|tee|select-object|select-string|select|sls|findstr|select-object|out-string|out-file|measure-object|measure`;

/** Suppression marker: deliberate pipe, reviewed. */
export const ESCAPE_MARKER = "ok-piped-git";

export type IssueKind = "pipe-loss" | "swallow" | "late-read";

export interface ShellIssue {
  kind: IssueKind;
  detail: string;
}

/** Split a command list into segments on ; && || boundaries (top level,
 *  naive w.r.t. nesting — warn-level accuracy, not a parser). */
function stripQuoted(command: string): string {
  return command.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ' "" ');
}

// (segment splitting lives inline in classifyShell: one splitter, two views)

export function classifyShell(command: string): ShellIssue[] {
  if (!command || command.includes(ESCAPE_MARKER)) return [];
  const issues: ShellIssue[] = [];
  const bare = stripQuoted(command);

  // One split, two views (FR-9): verb matching runs on stripped segments,
  // the $? scan on raw segments (a quoted `"rc=$?"` is still a late read).
  const splitter = /\n*(?:&&|\|\||;|\n)\s*/;
  const segsStripped = bare.split(splitter).filter((s) => s.length > 0);
  const segsRaw = command.split(splitter).filter((s) => s.length > 0);

  // P1 pipe-loss: state-changing git verb piped into a consumer — the
  // pipeline's exit code is the consumer's (0), the verb's failure vanishes.
  // Both the verb and the pipe must live in the SAME segment: a read-only
  // pipe in a later segment must not resurrect an earlier segment's verb.
  if (STATE_CHANGING_GIT.test(bare)) {
    const pipedTo = new RegExp(
      String.raw`\bgit\s(?:[^|;&\n]|&(?!&))*\|\s*(?:2>&1\s*)?(?:${CONSUMERS})\b`,
      "i",
    );
    const pipesInSameSegment = segsStripped.some(
      (seg) => STATE_CHANGING_GIT.test(seg) && pipedTo.test(seg),
    );
    if (pipesInSameSegment) {
      issues.push({
        kind: "pipe-loss",
        detail:
          "state-changing git verb piped into a consumer (tail/head/grep/…): the pipeline exit code is the CONSUMER's, so a failed push/commit/merge reads as success. Capture rc first (`git push …; rc=$?`) or drop the pipe.",
      });
    }

    // P2 swallow: failure replaced by true (same read-only tag exemption).
    // Segment-safe by construction: the verb→`|| true` stretch excludes
    // ; & | so the pattern cannot bind across segment boundaries.
    if (SWALLOW_GIT.test(bare)) {
      issues.push({
        kind: "swallow",
        detail: "`|| true` after a state-changing git verb discards its failure — the loop/classifier above will report green regardless. Handle the failure or let it propagate.",
      });
    }

    // P3 late-read: $?, captured only after an intervening command clobbered it.
    for (let i = 0; i < segsStripped.length && i < segsRaw.length; i++) {
      if (!STATE_CHANGING_GIT.test(segsStripped[i])) continue;
      const next = segsStripped[i + 1] ?? "";
      const readsRcImmediately =
        /^\s*\w+\s*=\s*\$\?/.test(next) || /^\s*\[\s*"?\$/.test(next) || /^\s*(?:if|while)\b/.test(next) || /^\s*\$\?/.test(next);
      if (!readsRcImmediately) {
        for (let j = i + 2; j < segsRaw.length; j++) {
          if (segsRaw[j].includes("$?")) {
            issues.push({
              kind: "late-read",
              detail:
                "`$?` is read only after intervening commands — by then it holds the LAST command's status, not the git verb's. Capture immediately: `git push …; rc=$?; echo \"push rc=$rc\"`.",
            });
            break;
          }
        }
      }
    }
  }
  return issues;
}

export function formatIssues(issues: ShellIssue[]): string {
  return issues.map((i) => `rc-gate [${i.kind}]: ${i.detail}`).join("\n");
}
