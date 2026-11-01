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

test("pipe-loss: read-only git tag listing forms are exempt (FR-6)", () => {
  assert.deepEqual(kinds("git tag | head -3"), []);
  assert.deepEqual(kinds('git tag -l "v*" | head'), []);
  assert.deepEqual(kinds("git tag --format='%(refname)' | cat"), []);
  assert.deepEqual(kinds("git tag -n | head"), []);
  assert.deepEqual(kinds("git tag --contains v1.0 | head"), []);
  assert.deepEqual(kinds("git tag --points-at v1.0"), []);
  assert.deepEqual(kinds("git tag --merged main | sort"), []);
  assert.deepEqual(kinds("git tag --no-merged main | wc -l"), []);
  assert.deepEqual(kinds("git tag --sort=-creatordate | head"), []);
  assert.deepEqual(kinds("git tag --column | cat"), []);
  assert.deepEqual(kinds("git tag --color | cat"), []);
});

test("pipe-loss: git tag write forms still flagged", () => {
  assert.ok(kinds("git tag v1.2.3 | head").includes("pipe-loss"));
  assert.ok(kinds("git tag -d v1 | head").includes("pipe-loss"));
  assert.ok(kinds("git tag -a v1 -m msg | head").includes("pipe-loss"));
});

test("swallow: read-only git tag exempt, write forms flagged", () => {
  assert.deepEqual(kinds("git tag || true"), []);
  assert.ok(kinds("git tag v1 || true").includes("swallow"));
  assert.ok(kinds("git tag -d v1 || true").includes("swallow"));
});

test("late-read: git tag write form still flagged", () => {
  assert.ok(kinds("git tag v1.2.3; echo done; echo $?").includes("late-read"));
});

test("canonical immediate capture passes", () => {
  assert.deepEqual(kinds('git push -q origin main; rc=$?; echo "push rc=$rc"; [ "$rc" -eq 0 ] || exit 1'), []);
  assert.deepEqual(kinds('git commit -q -m x && echo committed'), []);
});

// FR-9: P1 pipe-loss must not conflate verbs across segments.
test("pipe-loss: state-changing verb in one segment, read-only pipe in a later segment passes (FR-9)", () => {
  assert.deepEqual(
    kinds("git push origin main; rc=$?; remote=$(git ls-remote origin refs/heads/main | cut -f1)"),
    [],
  );
  assert.deepEqual(kinds("git commit -m x; git log --oneline | head -20"), []);
});

test("pipe-loss: verb and consumer pipe in the SAME segment still flagged (FR-9)", () => {
  assert.ok(kinds("git push origin main | tail -1").includes("pipe-loss"));
  assert.ok(kinds("rc=$?; git push origin main | tail -1").includes("pipe-loss"));
  assert.ok(kinds("git push origin main | tail -1; rc=$?").includes("pipe-loss"));
});

// FR-9 pin: SWALLOW_GIT's char class cannot cross ; && || so `|| true`
// after an unrelated later segment must not fire on an earlier git verb.
test("swallow: || true cannot bind across segment boundaries (FR-9 pin)", () => {
  assert.deepEqual(kinds("git push -q origin main; mkdir -p out || true"), []);
  assert.deepEqual(kinds("git push -q origin main && mkdir -p out || true"), []);
  assert.deepEqual(kinds("git push -q origin main\nmkdir -p out || true"), []);
  // same-segment swallow still flagged
  assert.ok(kinds("git push -q origin main || true").includes("swallow"));
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
