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
