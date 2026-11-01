# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1]

### Fixed

- **Read-only verb forms no longer warn.** `git stash list|show`, `git apply
  --check|--stat|--numstat|--summary`, `git commit --dry-run`, `git push
  --dry-run`, and `git clean -n|--dry-run` cannot fake a green write, so
  flagging them was pure noise (and noise is how a warn-gate gets muted). The
  same exemption table now drives the pipe check and the swallow check, so the
  two can no longer drift apart. `git stash` (bare = push), `git stash pop`,
  and `git apply <patch>` still fire; `git checkout --dry-run` still fires
  because that flag does not exist in git — the command genuinely fails, which
  is exactly when its rc must not be lost.
- **`scripts/rc-gate.sh` now runs on stock macOS `/bin/bash` 3.2.** It used
  `mapfile` (bash 4), so on a default macOS shell it died with `mapfile:
  command not found` and exited **1** — the same code as "found a finding", so
  a hook could not tell a dirty script from a broken linter. Exit codes are now
  0 clean, 1 findings, 2 usage/no-git/no-such-file, 3 internal error.
- **The late-read check in `scripts/rc-gate.sh` actually runs.** It was an
  `if … then : fi` no-op, so the script promised three classes in its own
  header and checked two. It now mirrors the TS classifier: the segment right
  after the git verb must capture `$?` itself.
- **Static lint line numbers** are the file's real line numbers again (they
  counted matched lines, not file lines).

### Added

- **Windows / `powershell` coverage.** The extension hooks the `powershell`
  tool and the consumer list includes `Select-Object`, `Select-String`,
  `Out-String`, `Out-File`, `Measure-Object`, `findstr`, `sls` — `git push |
  Select-Object -Last 5` loses the exit code exactly like `| tail -5`.
- **`git clean` is in scope.** `git clean -fd | cat` deleting untracked work
  behind a green pipeline is the same false-green class; `-n`/`--dry-run` is
  exempt.
- Tests for every exemption above, the resurrected late-read branch, and the
  bash-3.2 / exit-code behaviour (22 → 29 tests).
