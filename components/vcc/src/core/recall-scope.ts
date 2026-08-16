type RecallScope = "lineage" | "all" | `compaction:${string}`;
export type RecallMode = "history" | "file" | "touched";

interface ParsedRecallScope {
  scope: RecallScope;
  compactionIndex?: number; // 0-based compaction number to scope to
  text: string;
}

const SCOPE_RE = /\bscope:(lineage|all|compaction:(\d+|latest))\b/i;

export const normalizeRecallScope = (scope?: unknown): RecallScope => {
  if (typeof scope !== "string") return "lineage";
  const lower = scope.toLowerCase();
  if (lower === "all") return "all";
  if (lower.startsWith("compaction:")) return lower as RecallScope;
  return "lineage";
};

export const normalizeRecallMode = (mode?: unknown): RecallMode =>
  mode === "file" || mode === "touched" ? mode : "history";

/**
 * Parse scope directive from a recall query string or structured scope.
 * Returns the parsed scope and the cleaned query text.
 */
export const parseRecallScope = (text: string): ParsedRecallScope => {
  const match = text.match(SCOPE_RE);
  if (!match) {
    return { scope: "lineage", text: text.replace(/\s+/g, " ").trim() };
  }

  const rawScope = match[0];
  const cleaned = text.replace(SCOPE_RE, "").replace(/\s+/g, " ").trim();

  // compaction:N or compaction:latest
  if (match[1]?.toLowerCase().startsWith("compaction")) {
    const val = match[2];
    if (val?.toLowerCase() === "latest") {
      return { scope: "compaction:latest", text: cleaned };
    }
    const num = parseInt(val ?? "0", 10);
    return {
      scope: `compaction:${num}` as RecallScope,
      compactionIndex: isNaN(num) ? undefined : num,
      text: cleaned,
    };
  }

  return { scope: normalizeRecallScope(match[1]), text: cleaned };
};
