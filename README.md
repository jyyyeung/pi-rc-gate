# pi-rc-gate

[![npm](https://img.shields.io/npm/v/pi-rc-gate?style=flat&logo=npm&logoColor=white)](https://www.npmjs.com/package/pi-rc-gate) [![CI](https://img.shields.io/github/actions/workflow/status/jyyyeung/pi-rc-gate/test.yml?style=flat&logo=github&label=CI)](https://github.com/jyyyeung/pi-rc-gate/actions/workflows/test.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat)](https://opensource.org/licenses/MIT) [![Pi](https://img.shields.io/badge/pi-%E2%89%A51.3-6366F1?style=flat)](https://pi.dev) [![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org)

Exit-code honesty for coding agents: **catch the false green before it is reported.**

Agents run state-changing commands in shells, then report results. Three shell
idioms silently destroy the failure signal — and every one of them has produced
real "done, tests pass" claims over failed commands:

```bash
git push origin main 2>&1 | tail -5      # pipeline rc = tail's rc = 0
git push -q origin main || true          # failure discarded, loop "succeeds"
git push -q origin main; echo done; echo "rc=$?"   # $? is echo's status: 0
```

pi-rc-gate recognizes these as they are typed and warns **before** the agent
reports results — the timing that breaks the false-green habit. Install it if
you have ever had an agent say "pushed" while the branch was unchanged.

## Install

```bash
pi install npm:pi-rc-gate
```

Then restart pi (or `/reload`). No configuration.

From a local checkout:

```bash
pi install ./pi-rc-gate
pi -e ./pi-rc-gate/extensions/rc-gate.ts
```

## Quick start

Nothing to set up. Keep working — the warn arrives as a steer (a message the
agent sees before its next turn, not a block), so the command still runs:

```
pi-rc-gate WARN (not blocked): this command can produce a false green.
[pipe-loss] state-changing git verb piped into a consumer (tail/head/grep/…):
the pipeline exit code is the CONSUMER's, so a failed push/commit/merge reads as
success. Capture rc first (`git push …; rc=$?`) or drop the pipe.
Canonical shape: capture rc BEFORE any other statement —
`git push -q origin main; rc=$?; echo "push rc=$rc"; [ "$rc" -eq 0 ] || { echo FAILED; return 1; }`
(escape a deliberate pipe with a trailing `# ok-piped-git` comment)
```

One warn per issue kind per session, so the gate never becomes background noise
you learn to ignore. Warnings cover the `bash` tool and the `powershell` tool
(with PowerShell consumer aliases: `Select-Object`, `Select-String`, `Out-String`, …).

### The canonical shape

```bash
git push -q origin main; rc=$?; echo "push rc=$rc"
[ "$rc" -eq 0 ] || { echo FAILED; return 1; }
```

Between the command and `$?` there must be **nothing** — one `echo` in between
and `$?` holds the echo's status.

## What it checks

| Class | Shape | Why it lies |
|---|---|---|
| **Pipe loss** | `git <state-changing verb> … \| tail/head/grep/…` | The pipeline's status is the last command's. A failed `push` piped into `tail` exits 0. |
| **Swallow** | `git <verb> … \|\| true` (or `\|\| :`) | The failure is replaced by success; a retry loop can never fail. |
| **Late read** | `git <verb> … ; other-command; echo $?` | `$?` belongs to the last intervening command, not the git op. |

Only **state-changing** verbs count — `push`, `commit`, `merge`, `rebase`,
`fetch`, `pull`, `clone`, `stash` (bare), `apply`, `clean`, `reset`, `checkout`,
`tag` (creating), … Read-only forms are exempt, because a warn layer only
survives if it stays quiet where the exit code cannot lie.

### What is *not* flagged

The same table drives the pipe check, the swallow check, and the linter, so the
three can never drift apart:

| Read-only form | Why exempt |
|---|---|
| `git tag`, `git tag -l/-n/--contains/--points-at/--format=…` | lists refs |
| `git stash list`, `git stash show` | reads |
| `git apply --check/--stat/--numstat/--summary` | inspects a patch |
| `git commit --dry-run`, `git push --dry-run` | reports, sends nothing |
| `git clean -n`, `git clean -nd`, `git clean --dry-run` | lists |

The state-changing spelling of the same verb still fires: `git stash` (bare =
push), `git stash pop`, `git apply p.diff`, `git clean -fd`. And
`git checkout --dry-run` fires too — that flag does not exist in git, so the
command fails, which is precisely the rc you need to see.

Deliberate, reviewed pipes are marked with a trailing `# ok-piped-git` comment,
in shell commands and in script lines alike.

## Static lint (`scripts/rc-gate.sh`)

The same three classes, over shell files, for pre-commit and CI. No args = the
staged `*.sh` files. It runs on stock macOS bash 3.2 (no `mapfile`, no bash-4
arrays) and keeps line numbers, so a finding points at the line that lies.

| Exit | Meaning |
|---|---|
| **0** | clean |
| **1** | findings |
| **2** | usage / not a git repo / no such file |
| **3** | internal error |

A broken linter is never reported as a dirty script: infrastructure failures get
their own code instead of masquerading as findings.

```bash
bash scripts/rc-gate.sh              # staged shell files
bash scripts/rc-gate.sh run.sh ci.sh # explicit files
echo $?                              # 0 clean · 1 findings · 2/3 tool problem
```

### Pre-commit wiring

```yaml
# .pre-commit-config.yaml
- repo: local
  hooks:
    - id: rc-gate
      name: rc-gate (exit-code honesty)
      entry: bash /path/to/rc-gate.sh
      language: system
      files: \.(sh|bash)$
```

## The skill

The extension warns; the bundled `rc-gate` skill is the protocol behind the
warnings, for the cases no static check can see: capture rc before any other
statement, verify the claimed effect on disk (`git ls-remote` after a push,
`git log -1` after a commit, read the file back), and treat a child agent's
prose as a claim rather than evidence.

## Scope and non-goals

- **Not a shell linter.** Shellcheck covers syntax and quoting. This knows one
  thing shellcheck cannot: that piping a *git push* specifically converts its
  failure into success.
- **Not a blocker.** Warnings only, never a block — a guard that can stop your
  pipeline gets uninstalled the first time it is wrong.
- **Not a verification engine.** It cannot know whether a push landed; it makes
  the agent notice that it did not check.
- **Not exhaustive over dynamic shells.** `bash -c "$(...)"` and other
  indirection are out of reach by construction; only text the tool call actually
  contains is classified.

## Requirements

| Requirement | Needed for | If missing |
|---|---|---|
| pi ≥ 1.3 | the runtime warn layer | the extension does not load; the script and skill still work |
| Node ≥ 20 | the runtime warn layer | same |
| bash 3.2+ (any macOS/Linux shell) | `scripts/rc-gate.sh` | — |

No network access, no telemetry, no runtime dependencies beyond pi's own
packages.

## Troubleshooting

**It warned on a command whose exit code was fine.** Correct behaviour for the
shape, not for the intent — that is the point. Mark the line `# ok-piped-git`
and it stays silent forever; read-only verbs are exempted in the classifier
itself, so `git stash list | head` never warns.

**It only warned once.** By design: one steer per issue kind per session. Use
`/new` (or a fresh session) if you want the demonstration again.

**The warn did not appear at all.** Check `RC_GATE_DISABLE` — if it is set to
anything truthy the layer is off. The script layer is independent.

**`rc-gate.sh` printed nothing and exited 2.** That is "no staged shell files"
or a path that does not exist, not a clean pass. Run it with explicit paths.

## Related packages

Five extensions for the same problem — agent sessions sharing a checkout —
covering different moments:

| Package | Moment | Guards against |
|---|---|---|
| **pi-rc-gate** (this) | at execution | the failure signal being destroyed, so a red command is reported green |
| [pi-checkout-guard](https://github.com/jyyyeung/pi-checkout-guard) | during | concurrent sessions wiping each other's uncommitted work |
| [pi-closeout](https://github.com/jyyyeung/pi-closeout) | at session end | the dirty state a session leaves for the next one |
| [pi-retro](https://github.com/jyyyeung/pi-retro) | weekly | friction that keeps recurring because nobody wrote it down |
| [pi-handoff](https://github.com/jyyyeung/pi-handoff) | between sessions | context lost when a session ends |

## Development

```bash
npm install
npm run typecheck
npm test
```

## License

MIT © jyyyeung
