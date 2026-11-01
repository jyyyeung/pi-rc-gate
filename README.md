# pi-rc-gate

Exit-code honesty for coding agents: **catch the false green before it's
reported.**

Agents run state-changing commands in shells, then report results. Three
shell idioms silently destroy the failure signal — and every one of them has
produced real "done, tests pass" claims over failed commands:

```bash
git push origin main 2>&1 | tail -5      # pipeline rc = tail's rc = 0
git push -q origin main || true          # failure discarded, loop "succeeds"
git push -q origin main; echo done; echo "rc=$?"   # $? is echo's status: 0
```

pi-rc-gate recognizes these as they are typed and warns **before** the agent
reports results — the timing that breaks the false-green habit.

## What it does

| Layer | Behavior |
|---|---|
| **Runtime warn (extension)** | On `bash` and `powershell` tool calls: flags state-changing git verbs piped into consumers (`tail`/`head`/`grep`/…, `Select-Object`/`Out-String`/… on Windows), `\|\| true` swallows, and late `$?` reads (captured only after intervening commands clobbered it). Warn-only, one steer per issue kind per session. |
| **Static lint (`scripts/rc-gate.sh`)** | Same classes over shell files — pre-commit/CI. No args = staged `*.sh` via git. Runs on stock macOS bash 3.2. Exit **0** clean, **1** findings, **2** usage/no-git/no-such-file, **3** internal error — a broken linter is never reported as a dirty script. |
| **Skill** | The protocol behind the warnings: capture rc before any other statement; verify claimed effects on disk (`git ls-remote` after push, `git log -1` after commit, read files back); treat child-agent prose as claims, not evidence. |

```bash
$ pi install npm:pi-rc-gate
```

No configuration. Disable the runtime layer with `RC_GATE_DISABLE=1`. Mark a
deliberate, reviewed pipe with a trailing `# ok-piped-git` comment — in shell
commands and script lines alike.

### The canonical shape

```bash
git push -q origin main; rc=$?; echo "push rc=$rc"
[ "$rc" -eq 0 ] || { echo FAILED; return 1; }
```

Between the command and `$?` there must be **nothing** — one `echo` in
between and `$?` holds the echo's status.

### What is *not* flagged

A warn-layer only survives if it stays quiet on commands whose exit code
cannot lie. These are deliberately exempt (the same table drives the pipe and
the swallow check, and `scripts/rc-gate.sh` mirrors it):

| Read-only form | Why exempt |
|---|---|
| `git tag`, `git tag -l/-n/--contains/--points-at/--format=/…` | lists refs |
| `git stash list`, `git stash show` | reads |
| `git apply --check/--stat/--numstat/--summary` | inspects a patch |
| `git commit --dry-run`, `git push --dry-run` | reports, sends nothing |
| `git clean -n`, `git clean -nd`, `git clean --dry-run` | lists |

The state-changing spelling of the same verb still fires: `git stash` (bare =
push), `git stash pop`, `git apply p.diff`, `git clean -fd`. And
`git checkout --dry-run` fires too — that flag does not exist in git, so the
command fails, which is precisely the rc you need to see.

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

## How this differs from neighbors

Shellcheck lints syntax and quoting; it does not know that piping a *git
push* specifically converts its failure into success. Safety nets block
destructive commands; pi-rc-gate guards the *reporting* of commands — the
failure class where nothing looks destructive and everything looks green.
Pairs with pi-checkout-guard (during) and pi-closeout (after): rc-gate is
the honesty layer at the moment of execution.

## Development

```bash
npm install
npm run typecheck
npm test
```

## License

MIT © jyyyeung
