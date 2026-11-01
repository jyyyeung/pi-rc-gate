import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/rc-gate.sh", import.meta.url));

/** Run the static lint against a fixture with the given shell lines; return exit code. */
function lint(lines: string[]): number {
  const dir = mkdtempSync(join(tmpdir(), "rc-gate-script-"));
  try {
    const fixture = join(dir, "fixture.sh");
    writeFileSync(fixture, `#!/usr/bin/env bash\n${lines.join("\n")}\n`);
    try {
      execFileSync("bash", [SCRIPT, fixture], { stdio: "pipe" });
      return 0;
    } catch (err) {
      const status = (err as { status?: number }).status;
      assert.equal(typeof status, "number", `lint crashed: ${err}`);
      return status as number;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("FR-9: canonical rc-capture shape must not warn (verb and read-only pipe in different segments)", () => {
  assert.equal(lint(["git push origin main; rc=$?; remote=$(git ls-remote origin refs/heads/main | cut -f1)"]), 0);
});

test("pipe-loss: git verb piped to consumer in the same segment still fires", () => {
  assert.equal(lint(["git push origin main | tail -1"]), 1);
});

test("swallow: || true cannot bind across a ; segment boundary", () => {
  assert.equal(lint(["git push -q origin main; echo done || true"]), 0);
});

test("swallow: || true in the same segment as the verb fires", () => {
  assert.equal(lint(["git push -q origin main || true"]), 1);
});

test("escape marker and clean file still exit 0", () => {
  assert.equal(lint(["git push origin main | tail -1 # ok-piped-git"]), 0);
  assert.equal(lint(["echo hello; ls -la | tail -3"]), 0);
});

test("multiple findings in one line still count (pipe-loss and swallow both fire)", () => {
  assert.equal(lint(["git push origin main | tail -1 || true"]), 1);
});

test("read-only forms are exempt in the static lint too (tag/stash list/--check/--dry-run/clean -n)", () => {
  assert.equal(lint(["git tag | head -3"]), 0);
  assert.equal(lint(["git stash list | head"]), 0);
  assert.equal(lint(["git apply --check p.diff | cat"]), 0);
  assert.equal(lint(["git commit --dry-run | cat"]), 0);
  assert.equal(lint(["git clean -nd | head"]), 0);
  assert.equal(lint(["git clean -fd | cat"]), 1);
});

test("late-read: $? read after an intervening command is reported (the branch that used to be dead)", () => {
  assert.equal(lint(["git push -q origin main; echo done; echo \"rc=$?\""]), 1);
  assert.equal(lint(["git push -q origin main; rc=$?; echo done; echo \"rc=$rc\""]), 0);
});

test("runs on stock macOS bash 3.2 and reports a distinct code for a missing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "rc-gate-script-"));
  try {
    const fixture = join(dir, "fixture.sh");
    writeFileSync(fixture, "#!/usr/bin/env bash\ngit push origin main | tail -1\n");
    // bash 3.2 has no mapfile: this used to die with "mapfile: command not found"
    // and exit 1 — indistinguishable from a finding.
    const out = execFileSync("/bin/bash", ["--version"], { encoding: "utf8" });
    if (!out.includes("version 3.2")) return; // only meaningful on stock macOS bash
    let status: number | undefined;
    try {
      execFileSync("/bin/bash", [SCRIPT, fixture], { stdio: "pipe" });
      status = 0;
    } catch (err) {
      status = (err as { status?: number }).status;
      assert.ok(!String((err as { stderr?: Buffer }).stderr ?? "").includes("mapfile"), "script must not use bash-4 mapfile");
    }
    assert.equal(status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  let missing: number | undefined;
  try {
    execFileSync("bash", [SCRIPT, "/definitely/not/here.sh"], { stdio: "pipe" });
    missing = 0;
  } catch (err) {
    missing = (err as { status?: number }).status;
  }
  assert.equal(missing, 2, "a missing file is a usage error (2), not a finding (1)");
});
