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

/** State-changing git verbs whose failure MUST reach the caller. */
export const STATE_CHANGING_GIT = new RegExp(
  String.raw`\bgit\s+(?:-{1,2}[\w-]+(?:\s+"[^"]*"|\s+'[^']*'|\s+\S+)?\s+)*(?:push\b|commit\b|merge(?!-(?:base|ours|theirs|file))\b|rebase\b|reset\b|checkout\b|switch\b|stash\b|pull\b|${READONLY_TAG_TAIL}|cherry-pick\b|revert\b|apply\b|am\b|worktree\s+(?:add|remove)\b|branch\s+-\w*[Dd]\b)`,
);

/** `|| true`/`|| :` swallowing one of the state-changing verbs (P2). */
const SWALLOW_GIT = new RegExp(
  String.raw`\bgit\s(?:[^|;&\n]|&(?!&))*(?:push|commit|merge|rebase|reset|stash|pull|${READONLY_TAG_TAIL}|cherry-pick|revert|apply)\b(?:[^|;&\n]|&(?!&))*\|\|\s*(?:true\b|:)`,
);

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

// (segment splitting lives inline in classifyShell: verb matching runs on
// stripped text, the $? scan on raw text — one splitter, two views)

export function classifyShell(command: string): ShellIssue[] {
  if (!command || command.includes(ESCAPE_MARKER)) return [];
  const issues: ShellIssue[] = [];
  const bare = stripQuoted(command);

  // P1 pipe-loss: state-changing git verb piped into a consumer — the
  // pipeline's exit code is the consumer's (0), the verb's failure vanishes.
  if (STATE_CHANGING_GIT.test(bare)) {
    if (/\bgit\s(?:[^|;&\n]|&(?!&))*\|\s*(?:2>&1\s*)?(?:tail|head|grep|egrep|fgrep|sed|awk|cat|less|more|jq|cut|sort|uniq|wc|tee)\b/.test(bare)) {
      issues.push({
        kind: "pipe-loss",
        detail:
          "state-changing git verb piped into a consumer (tail/head/grep/…): the pipeline exit code is the CONSUMER's, so a failed push/commit/merge reads as success. Capture rc first (`git push …; rc=$?`) or drop the pipe.",
      });
    }

    // P2 swallow: failure replaced by true (same read-only tag exemption).
    if (SWALLOW_GIT.test(bare)) {
      issues.push({
        kind: "swallow",
        detail: "`|| true` after a state-changing git verb discards its failure — the loop/classifier above will report green regardless. Handle the failure or let it propagate.",
      });
    }

    // P3 late-read: $?, captured only after an intervening command clobbered it.
    // Verb matching uses stripped segments; the $? scan uses the RAW segments
    // (a quoted `"rc=$?"` is still a late read).
    const splitter = /\n*(?:&&|\|\||;|\n)\s*/;
    const segsStripped = stripQuoted(command).split(splitter).filter((s) => s.length > 0);
    const segsRaw = command.split(splitter).filter((s) => s.length > 0);
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
