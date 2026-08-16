/**
 * context.ts — Extract parent conversation context for subagent inheritance.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Extract text from a message content block array. */
export function extractText(content: unknown[]): string {
  return content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text ?? "")
    .join("\n");
}

function parentBranch(ctx: ExtensionContext): any[] {
  // Programmatic callers and focused tests can supply a narrower session-manager
  // surface. No parent branch simply means no handoff, never a spawn failure.
  return (ctx.sessionManager as any)?.getBranch?.() ?? [];
}

/**
 * Build the complete text conversation for an invocation with
 * `inherit_context: true`. Tool and extension records intentionally remain
 * excluded; the child receives the complete parent text conversation.
 */
export function buildFullParentContext(ctx: ExtensionContext): string {
  const entries = parentBranch(ctx);
  if (entries.length === 0) return "";

  const parts: string[] = [];
  for (const entry of entries) {
    if (entry.type === "message") {
      const msg = entry.message;
      if (msg.role === "user") {
        const text = typeof msg.content === "string" ? msg.content : extractText(msg.content);
        if (text.trim()) parts.push(`[User]: ${text.trim()}`);
      } else if (msg.role === "assistant") {
        const text = extractText(msg.content);
        if (text.trim()) parts.push(`[Assistant]: ${text.trim()}`);
      }
    } else if (entry.type === "compaction" && entry.summary) {
      parts.push(`[Summary]: ${entry.summary}`);
    }
  }
  if (parts.length === 0) return "";

  return `# Parent Conversation Context
The following is the complete conversation history from the parent session that spawned you.
Use it only when necessary to complete the assigned task.

${parts.join("\n\n")}

---
# Your Task (below)
`;
}
