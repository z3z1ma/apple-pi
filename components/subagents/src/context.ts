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

/**
 * Build a bounded handoff from the parent session.
 *
 * `inherit_context` is intentionally not a transcript clone: a child needs the
 * assigned prompt as its authority, plus only enough recent state to avoid
 * rediscovering decisions. Full histories make every child expensive and blur
 * its completion boundary. Prefer the latest compaction summary, then the most
 * recent user request and assistant report. Tool results remain excluded.
 */
export function buildParentContext(ctx: ExtensionContext): string {
  const entries = ctx.sessionManager.getBranch();
  if (!entries || entries.length === 0) return "";

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
