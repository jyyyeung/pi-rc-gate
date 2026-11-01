/**
 * pi-rc-gate extension for the pi coding agent.
 *
 * Warns (never blocks) when a bash tool command would lose a state-changing
 * command's exit code: piped git verbs, `|| true` swallows, late `$?` reads.
 * The warning arrives as a steer BEFORE the agent reports results, breaking
 * the false-green habit at its source.
 *
 * Disable with RC_GATE_DISABLE=1. Mark a deliberate pipe with a trailing
 * `# ok-piped-git` comment on the command.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classifyShell, formatIssues } from "../src/patterns.ts";

export default function rcGateExtension(pi: ExtensionAPI): void {
  if (process.env.RC_GATE_DISABLE === "1") return;

  const warned = new Set<string>(); // one steer per distinct issue kind per session

  pi.on("tool_call", async (event) => {
    const toolName: string = (event as { toolName?: string }).toolName ?? "";
    // `powershell` is a separate tool with the same {command} input shape on
    // Windows; the classifier's consumer list carries the PS aliases, so the
    // same gate applies.
    if (toolName !== "bash" && toolName !== "bash-in" && toolName !== "powershell") return;
    const input = ((event as { input?: unknown }).input ?? {}) as Record<string, unknown>;
    const command = typeof input.command === "string" ? input.command : "";
    const issues = classifyShell(command);
    const fresh = issues.filter((i) => !warned.has(i.kind));
    if (fresh.length === 0) return;
    for (const i of fresh) warned.add(i.kind);
    await pi.sendMessage(
      {
        customType: "pi-rc-gate-warn",
        content:
          `pi-rc-gate WARN (not blocked): this command can produce a false green.\n` +
          formatIssues(fresh) +
          `\nCanonical shape: capture rc BEFORE any other statement — ` +
          `\`git push -q origin main; rc=$?; echo "push rc=$rc"; [ "$rc" -eq 0 ] || { echo FAILED; return 1; }\`` +
          `\n(escape a deliberate pipe with a trailing \`# ok-piped-git\` comment)`,
        display: true,
      },
      { deliverAs: "steer" },
    );
  });
}
