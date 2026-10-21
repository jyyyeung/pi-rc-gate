import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyShell } from "../src/patterns.ts";

const kinds = (cmd: string) => classifyShell(cmd).map((i) => i.kind);

test("pipe-loss: state-changing git verb piped into tail/head/grep flagged", () => {
  assert.ok(kinds("git push origin main 2>&1 | tail -5").includes("pipe-loss"));
  assert.ok(kinds("git commit -m x | grep -c insertion").includes("pipe-loss"));
  assert.ok(kinds("git merge feature | head").includes("pipe-loss"));
});

test("pipe-loss: read-only git verbs and non-git pipes pass", () => {
  assert.deepEqual(kinds("git log --oneline | head -20"), []);
  assert.deepEqual(kinds("git diff | grep TODO"), []);
  assert.deepEqual(kinds("ls -la | tail -3"), []);
  assert.deepEqual(kinds("cat build.log | grep -c ERROR"), []);
});

test("pipe-loss: redirect to file is fine", () => {
  assert.deepEqual(kinds("git push origin main >push.log 2>&1"), []);
});

test("swallow: || true after state-changing git verb flagged", () => {
  assert.ok(kinds("git push -q origin main || true").includes("swallow"));
  assert.ok(kinds("git commit -m x || :").includes("swallow"));
  assert.deepEqual(kinds("mkdir -p out || true"), []); // non-git OK to best-effort
});

test("late-read: $? after intervening echo flagged", () => {
  assert.ok(kinds('git push -q origin main; echo done; echo "rc=$?"').includes("late-read"));
});

test("canonical immediate capture passes", () => {
  assert.deepEqual(kinds('git push -q origin main; rc=$?; echo "push rc=$rc"; [ "$rc" -eq 0 ] || exit 1'), []);
  assert.deepEqual(kinds('git commit -q -m x && echo committed'), []);
});

test("escape marker suppresses", () => {
  assert.deepEqual(kinds("git push origin main 2>&1 | tail -5 # ok-piped-git"), []);
});

test("quoted strings never match (commit message mentioning pipe verbs)", () => {
  assert.deepEqual(kinds('git commit -m "never pipe git push into tail"'), []);
});

test("no issues on empty/plain commands", () => {
  assert.deepEqual(classifyShell(""), []);
  assert.deepEqual(kinds("echo hello"), []);
  assert.deepEqual(kinds("git status"), []);
});
