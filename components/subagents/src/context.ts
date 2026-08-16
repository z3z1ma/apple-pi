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

/** Maximum source characters carried into an opted-in parent handoff. */
export const MAX_PARENT_HANDOFF_CHARS = 12_000;

function clip(text: string, limit: number): string {
  const normalized = text.trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function parentBranch(ctx: ExtensionContext): any[] {
  // Programmatic callers and focused tests can supply a narrower session-manager
  // surface. No parent branch simply means no handoff, never a spawn failure.
  return (ctx.sessionManager as any)?.getBranch?.() ?? [];
}

/**
 * Build a bounded handoff from the parent session.
 *
 * Omitted inheritance uses this compact handoff: a child needs the assigned
 * prompt as its authority, plus only enough recent state to avoid rediscovering
 * decisions. Full histories make every child expensive and blur its completion
 * boundary. Prefer the latest compaction summary, then the most recent user
 * request and assistant report. Tool results remain excluded.
 */
export function buildCompactParentHandoff(ctx: ExtensionContext): string {
  const entries = parentBranch(ctx);
  if (entries.length === 0) return "";

  let summary = "";
  let user = "";
  let assistant = "";
  for (let index = entries.length - 1; index >= 0 && (!summary || !user || !assistant); index--) {
    const entry = entries[index];
    if (entry.type === "compaction" && !summary && entry.summary) {
      summary = entry.summary;
      continue;
    }
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (msg.role === "user" && !user) {
      user = typeof msg.content === "string" ? msg.content : extractText(msg.content);
    } else if (msg.role === "assistant" && !assistant) {
      assistant = extractText(msg.content);
    }
  }

  const parts = [
    summary && `[Session summary]: ${clip(summary, 8_000)}`,
    user && `[Latest user request]: ${clip(user, 2_000)}`,
    assistant && `[Latest assistant report]: ${clip(assistant, 2_000)}`,
  ].filter(Boolean);
  if (parts.length === 0) return "";

  return `# Parent Handoff
The task below is authoritative. This bounded context records recent decisions; do not expand scope from it.

${parts.join("\n\n")}

---
# Your Task (below)
`;
}

/**
 * Build the legacy complete text conversation for a trusted agent definition
 * with `inherit_context: true`. Tool and extension records intentionally remain
 * excluded, matching the prior inheritance contract. Ordinary child sessions
 * must use {@link buildCompactParentHandoff}.
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
