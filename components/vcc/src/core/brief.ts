import type { NormalizedBlock } from "../types";
import { clip, firstLine } from "./content";
import { extractPath } from "./tool-args";
import { collapseSkillText } from "./skill-collapse";
import { KEY_STOPS, refineBreadcrumbKey } from "./causal-keys";

const TRUNCATE_USER = 256;
const TRUNCATE_ASSISTANT = 200;

// Strip common self-reflective assistant prefixes that carry no semantic info.
// Conservative list: only removes the leading filler, preserves the actual content.
const SELF_TALK_PREFIX_RE =
  /^\s*(?:hmm|wait|actually|oh|okay|ok|well|so)[,.!\s-]+/i;

// ── noise filtering ──

const isNoiseUser = (text: string): boolean => {
  return !text.trim();
};

// ── truncation ──

// Common stop words — don't count toward budget
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "between", "under", "over",
  "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
  "neither", "each", "every", "all", "any", "few", "more", "most",
  "other", "some", "such", "no",
  "that", "this", "these", "those", "it", "its",
  "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "they", "them", "their", "who", "which", "what",
  "if", "then", "than", "when", "where", "how", "just", "also",
]);

// Fast word-aware truncation: regex word split with stopword budget.
// Replaces Intl.Segmenter which was ~2× slower with identical output.
// Content words = consecutive letters (optionally followed by alphanumerics)
// or digit sequences. Stopwords don't count toward the budget.
const CONTENT_WORD_RE = /\p{L}[\p{L}\p{N}]*|\p{N}+/gu;

const truncateTokens = (text: string, limit: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  let count = 0;
  let cutIdx = flat.length;
  CONTENT_WORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CONTENT_WORD_RE.exec(flat)) !== null) {
    if (!STOP_WORDS.has(match[0].toLowerCase())) {
      count++;
      if (count > limit) {
        cutIdx = match.index;
        break;
      }
    }
    cutIdx = match.index + match[0].length;
  }
  if (count <= limit) return flat;
  return flat.slice(0, cutIdx).trimEnd() + "...(truncated)";
};

// ── bash command compression ──

const BASH_CAP = 120;
const PIPE_TAIL_RE = /\s*\|\s*(?:head|tail|sort|wc|column|tr|cut|awk|uniq|python3|node|bun)(?:\s[^|]*)?$/;

/** Semantic compression: strip cd prefix, pipe tail formatting, cap length */
const compressBash = (raw: string): string => {
  // Flatten multi-line: take first meaningful line
  let cmd = raw.split("\n").map(l => l.trim()).filter(Boolean)[0] ?? raw;
  // Strip cd <path> && prefix
  cmd = cmd.replace(/^cd\s+\S+\s*&&\s*/, "");
  // Strip pipe tail formatting commands (up to 3 times)
  for (let i = 0; i < 3; i++) {
    const stripped = cmd.replace(PIPE_TAIL_RE, "");
    if (stripped === cmd) break;
    cmd = stripped;
  }
  if (cmd.length > BASH_CAP) {
    return cmd.slice(0, BASH_CAP - 3) + "...";
  }
  return cmd;
};

// ── tool summary ──

const TOOL_SUMMARY_FIELDS: Record<string, string> = {
  Read: "file_path", Edit: "file_path", Write: "file_path",
  read: "file_path", edit: "file_path", write: "file_path",
  Glob: "pattern", Grep: "pattern",
};

const toolOneLiner = (name: string, args: Record<string, unknown>): string => {
  const field = TOOL_SUMMARY_FIELDS[name];
  if (field && typeof args[field] === "string") {
    return `* ${name} "${args[field] as string}"`;
  }
  const path = extractPath(args);
  if (path) return `* ${name} "${path}"`;
  if (name === "bash" || name === "Bash") {
    const raw = (args.command ?? args.description ?? "") as string;
    const cmd = compressBash(raw);
    return `* ${name} "${cmd}"`;
  }
  if (typeof args.query === "string") {
    return `* ${name} "${clip(args.query as string, 60)}"`;
  }
  return `* ${name}`;
};

interface BriefLine {
  /** Section header like "[user]", "[assistant]", "[tool_error] bash" */
  header: string;
  /** Content lines for this section */
  lines: string[];
}

/** Structured transcript entry for JSON output */
export interface TranscriptEntry {
  role: "user" | "assistant" | "tool_error";
  text?: string;
  tool?: string;
  cmd?: string;
  ref?: string;
  /** Collapse count when identical tool calls are grouped */
  count?: number;
}

/**
 * Build BriefLine sections from NormalizedBlocks.
 */
export const buildBriefSections = (blocks: NormalizedBlock[]): BriefLine[] => {
  const sections: BriefLine[] = [];
  let lastHeader = "";

  const push = (header: string, line: string) => {
    if (header === lastHeader && sections.length > 0) {
      sections[sections.length - 1].lines.push(line);
      return;
    }
    sections.push({ header, lines: [line] });
    lastHeader = header;
  };

  for (const b of blocks) {
    switch (b.kind) {
      case "user": {
        if (isNoiseUser(b.text)) break;
        const text = truncateTokens(collapseSkillText(b.text), TRUNCATE_USER);
        if (text) {
          const ref = b.sourceIndex != null ? ` (#${b.sourceIndex})` : "";
          push("[user]", text + ref);
        }
        lastHeader = "[user]";
        break;
      }
      case "bash": {
        const cmd = compressBash(b.command);
        const ref = b.sourceIndex != null ? ` (#${b.sourceIndex})` : "";
        if (cmd) {
          push("[user]", `$ ${cmd}${ref}`);
        }
        lastHeader = "[user]";
        break;
      }
      case "assistant": {
        let raw = b.text;
        // Strip leading self-talk prefix (up to 2x; assistants sometimes chain "Hmm, actually, ...")
        for (let i = 0; i < 2; i++) {
          const stripped = raw.replace(SELF_TALK_PREFIX_RE, "");
          if (stripped === raw) break;
          raw = stripped;
        }
        const text = truncateTokens(raw, TRUNCATE_ASSISTANT);
        if (text) {
          const ref = b.sourceIndex != null ? ` (#${b.sourceIndex})` : "";
          push("[assistant]", text + ref);
        }
        break;
      }
      case "tool_call": {
        // Skip malformed tool calls from streaming providers (empty name / fragmented args).
        if (!b.name || b.name.trim() === "") break;
        const ref = b.sourceIndex != null ? ` (#${b.sourceIndex})` : "";
        const summary = toolOneLiner(b.name, b.args) + ref;
        push("[assistant]", summary);
        break;
      }
      case "tool_result": {
        if (b.isError) {
          const body = firstLine(b.text, 150);
          // Drop empty/placeholder error bodies — keep the line only if it carries info.
          if (!body || body === "(no output)") break;
          const ref = b.sourceIndex != null ? ` (#${b.sourceIndex})` : "";
          const header = `[tool_error] ${b.name}${ref}`;
          push(header, body);
          lastHeader = header;
        }
        break;
      }
      case "thinking":
        break;
    }
  }

  // Collapse consecutive identical tool lines (same text, different #ref)
  for (const sec of sections) {
    if (sec.header !== "[assistant]") continue;
    const out: string[] = [];
    for (const line of sec.lines) {
      if (!line.startsWith("* ")) { out.push(line); continue; }
      const ref = line.match(/\(#(\d+)\)$/)?.[1] ?? "";
      const base = ref ? line.slice(0, -(ref.length + 3)).trimEnd() : line;
      const last = out.length > 0 ? out[out.length - 1] : "";
      const m = last.match(/^(.*) \((#[\d, #]+)\) x(\d+)$/);
      if (m && m[1] === base) {
        out[out.length - 1] = `${base} (${m[2]}, #${ref}) x${parseInt(m[3]) + 1}`;
      } else if (last.match(/\(#\d+\)$/) && last.replace(/\s*\(#\d+\)$/, "") === base) {
        const prevRef = last.match(/\(#(\d+)\)$/)?.[1];
        out[out.length - 1] = `${base} (#${prevRef}, #${ref}) x2`;
      } else {
        out.push(line);
      }
    }
    sec.lines = out;
  }

  // Cap tool calls per [assistant] turn — keep tail (latest actions tend to
  // be the deciding edits/writes; head is usually exploration noise).
  const TOOL_CALLS_PER_TURN = 8;
  for (const sec of sections) {
    if (sec.header !== "[assistant]") continue;
    const toolIdxs = sec.lines
      .map((l, i) => (l.startsWith("* ") ? i : -1))
      .filter((i) => i >= 0);
    if (toolIdxs.length <= TOOL_CALLS_PER_TURN) continue;
    const dropCount = toolIdxs.length - TOOL_CALLS_PER_TURN;
    const dropSet = new Set(toolIdxs.slice(0, dropCount));
    const firstKeptToolIdx = toolIdxs[dropCount];
    const next: string[] = [];
    let inserted = false;
    for (let i = 0; i < sec.lines.length; i++) {
      if (dropSet.has(i)) continue;
      if (!inserted && i === firstKeptToolIdx) {
        next.push(`* (${dropCount} earlier tool-call entries omitted)`);
        inserted = true;
      }
      next.push(sec.lines[i]);
    }
    sec.lines = next;
  }

  // Collapse consecutive identical [tool_error] sections (same tool, same body).
  // E.g. 20 back-to-back `[tool_error] bash (#N) ... Command aborted` become one
  // `[tool_error] bash (#refs...) x20` entry.
  const collapsedErrors: BriefLine[] = [];
  for (const sec of sections) {
    const m = sec.header.match(/^\[tool_error\]\s+(\S+?)(?:\s*\(#(\d+)\))?$/);
    if (!m || sec.lines.length !== 1) {
      collapsedErrors.push(sec);
      continue;
    }
    const tool = m[1];
    const ref = m[2];
    const body = sec.lines[0];
    const prev = collapsedErrors[collapsedErrors.length - 1];
    const prevMatch = prev?.header.match(
      /^\[tool_error\]\s+(\S+?)\s*\(((?:#\d+(?:,\s*)?)+)\)(?:\s*x(\d+))?$/,
    );
    if (prev && prevMatch && prevMatch[1] === tool && prev.lines.length === 1 && prev.lines[0] === body) {
      const refs = prevMatch[2] + (ref ? `, #${ref}` : "");
      const count = prevMatch[3] ? parseInt(prevMatch[3]) + 1 : 2;
      prev.header = `[tool_error] ${tool} (${refs}) x${count}`;
    } else {
      collapsedErrors.push(sec);
    }
  }
  sections.length = 0;
  sections.push(...collapsedErrors);

  return sections;
};

/**
 * Stringify BriefLine sections into text format.
 */
export const stringifyBrief = (sections: BriefLine[]): string => {

  // Emit sections -- suppress blank lines between consecutive tool summaries
  const out: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (i > 0) {
      const prev = sections[i - 1];
      const prevIsTools = prev.header === "[assistant]" &&
        prev.lines.every((l) => l.startsWith("* "));
      const curIsTools = sec.header === "[assistant]" &&
        sec.lines.every((l) => l.startsWith("* "));
      if (!(prevIsTools && curIsTools)) {
        out.push("");
      }
    }
    out.push(sec.header);
    for (const line of sec.lines) {
      out.push(line);
    }
  }

  return out.join("\n");
};

/** Parse a text line into a structured TranscriptEntry */
const parseToolLine = (line: string): { tool: string; cmd?: string; ref?: string; count?: number } | null => {
  // * bash "cmd" (#5)
  // * bash "cmd" (#1, #3) x2
  // * tilth "query" (#7)
  const m = line.match(/^\* (\S+)\s*(?:"([^"]*)")?\s*(?:\((#[\d, #]+)\))?\s*(?:x(\d+))?$/);
  if (!m) return null;
  return {
    tool: m[1],
    cmd: m[2] || undefined,
    ref: m[3] || undefined,
    count: m[4] ? parseInt(m[4]) : undefined,
  };
};

const extractRef = (text: string): { clean: string; ref?: string } => {
  const m = text.match(/\s*\(#(\d+)\)$/);
  if (!m) return { clean: text };
  return { clean: text.slice(0, m.index).trimEnd(), ref: `#${m[1]}` };
};

/**
 * Convert BriefLine sections to structured TranscriptEntry array for JSON output.
 */
export const sectionsToTranscript = (sections: BriefLine[]): TranscriptEntry[] => {
  const entries: TranscriptEntry[] = [];

  for (const sec of sections) {
    if (sec.header === "[user]") {
      for (const line of sec.lines) {
        const { clean, ref } = extractRef(line);
        entries.push({ role: "user", text: clean, ...(ref && { ref }) });
      }
    } else if (sec.header === "[assistant]") {
      for (const line of sec.lines) {
        if (line.startsWith("* ")) {
          const parsed = parseToolLine(line);
          if (parsed) {
            entries.push({
              role: "assistant",
              tool: parsed.tool,
              ...(parsed.cmd && { cmd: parsed.cmd }),
              ...(parsed.ref && { ref: parsed.ref }),
              ...(parsed.count && { count: parsed.count }),
            });
          } else {
            // Fallback: unparseable tool line
            const { clean, ref } = extractRef(line.slice(2));
            entries.push({ role: "assistant", text: clean, ...(ref && { ref }) });
          }
        } else {
          const { clean, ref } = extractRef(line);
          entries.push({ role: "assistant", text: clean, ...(ref && { ref }) });
        }
      }
    } else if (sec.header.startsWith("[tool_error]")) {
      // [tool_error] bash (#5)
      const headerMatch = sec.header.match(/^\[tool_error\]\s+(\S+)\s*(?:\(#(\d+)\))?/);
      const tool = headerMatch?.[1] ?? "unknown";
      const ref = headerMatch?.[2] ? `#${headerMatch[2]}` : undefined;
      for (const line of sec.lines) {
        entries.push({
          role: "tool_error",
          tool,
          text: line,
          ...(ref && { ref }),
        });
      }
    }
  }

  return entries;
};

// ── convenience ──

/** Build and stringify the brief transcript in one call. */
export const compileBrief = (blocks: NormalizedBlock[]): string =>
  stringifyBrief(buildBriefSections(blocks));

// ── turn identification (HCA zone) ──

const WRITE_TOOLS = new Set([
  "Edit", "Write", "edit", "write", "MultiEdit",
]);

export interface TurnInfo {
  /** Per-turn one-line summary */
  summary: string;
}

/** Shorten a file path by taking the last 2 segments. */
const shortenPath = (p: string): string => {
  const parts = p.split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : p;
};

// ── causal extraction ──
// Marker-based extraction: scan for specific phrases that signal cause or
// resolution, then extract a bounded fragment after the marker.
//
// Why markers instead of regex patterns?
// 1. No backtracking risk — indexOf + linear char scan is O(n) worst case.
//    Regex with lazy quantifiers + alternation ([^.,;!?]+?)(?:[.,;!?]|$)
//    can theoretically backtrack, though JS engines limit this in practice.
// 2. Bounded by construction — FRAGMENT_MAX hard cap, no unbounded capture.
// 3. Easy to extend — add a string to the list, no regex syntax to debug.
// 4. Multi-sentence aware — tries full text first, then per-sentence.

// Cause markers: phrases that signal "here comes the reason/problem".
// Ordered from most specific to least specific; first match wins.
const CAUSE_MARKERS: readonly string[] = [
  "the issue is",
  "the problem is",
  "the problem was",
  "the bug is",
  "the bug was",
  "the cause is",
  "root cause:",
  "root cause is",
  "the reason is",
  "fails because",
  "fails when",
  "fails due to",
  "crashes because",
  "crashes when",
  "crashes due to",
  "breaks because",
  "breaks when",
  "breaks due to",
  "because ",
  "since ",
  "due to ",
  "missing ",
  "lacking ",
  "lack of ",
  "absence of ",
  "can't ",
  "cannot ",
  "not properly ",
  "not correctly ",
  "not validating ",
  "not returning ",
  "not handling ",
  "not releasing ",
  "not checking ",
  "wrong ",
  "incorrect ",
  "stale ",
  "outdated ",
  "unhandled ",
  "uncaught ",
];

// Resolution markers: phrases that signal "here comes the fix/action".
// Ordered from most specific to least specific; first match wins.
const RESOLUTION_MARKERS: readonly string[] = [
  "fix this by",
  "fix it by",
  "resolve this by",
  "resolve it by",
  "resolve by",
  "handle this by",
  "handle by",
  "address this by",
  "address by",
  "by adding",
  "by creating",
  "by implementing",
  "by introducing",
  "by applying",
  "by inserting",
  "by using",
  "by swapping",
  "by migrating",
  "by isolating",
  "by splitting",
  "by extracting",
  "by replacing",
  "by refactoring",
  "by wrapping",
  "by moving",
  "by removing",
  "added ",
  "created ",
  "implemented ",
  "introduced ",
  "applied ",
  "inserted ",
  "changed to",
  "updated to",
  "switched to",
  "migrated to",
  "replaced with",
  "replaced by",
  "refactored to",
  "extracted into",
  "set up ",
  "configured ",
  "enabled ",
  "swapped ",
  "isolated ",
  "splitting ",
  "split ",
  "wrapped ",
  "guarded ",
  "moved ",
  "removed ",
];

// Maximum chars for a causal fragment — hard cap prevents unbounded capture.
const FRAGMENT_MAX = 60;
// Maximum chars for a causal breadcrumb key — keeps the ...recall line bounded.
const CAUSAL_BREADCRUMB_MAX = 40;

// Characters that terminate a causal fragment.
const SENTINEL_CHARS = new Set([...
  ",.;!?\n"
]);

/**
 * Extract a bounded fragment starting after the first matching marker.
 * Stops at the first sentinel character or FRAGMENT_MAX chars, whichever
 * comes first. O(n) single pass — indexOf + linear scan, no regex.
 */
const extractFragment = (
  text: string,
  markers: readonly string[],
): string | null => {
  const lower = text.toLowerCase();
  for (const marker of markers) {
    const idx = lower.indexOf(marker);
    if (idx < 0) continue;
    const start = idx + marker.length;
    if (start >= text.length) continue;

    let end = start;
    while (end < text.length && end - start < FRAGMENT_MAX) {
      if (SENTINEL_CHARS.has(text[end])) break;
      end++;
    }
    const fragment = text.slice(start, end).trim();
    if (fragment.length < 4) continue;
    return fragment;
  }
  return null;
};

/**
 * Extract a causal fragment from assistant text.
 * Returns { cause, resolution } where each is a short string or null.
 *
 * Deterministic: same text always produces the same result.
 * O(n): indexOf + linear char scan per marker; no regex backtracking.
 * Bounded: fragments are capped at CAUSAL_BREADCRUMB_MAX chars.
 */
export const extractCausalChain = (
  text: string,
): { cause: string | null; resolution: string | null } => {
  // Try full text first (markers can span sentence boundaries)
  let cause = extractFragment(text, CAUSE_MARKERS);
  let resolution = extractFragment(text, RESOLUTION_MARKERS);

  // If we didn't find both, also try per-sentence (handles cases like
  // "The issue is a race condition. I fixed it by adding a mutex."
  // where cause and resolution are in different sentences but the
  // resolution marker "it by" doesn't match because "it" is too far
  // from the full text's start).
  if (!cause || !resolution) {
    const sentences = text.split(/[.!?]/).filter(s => s.trim().length > 3);
    for (const sentence of sentences) {
      if (!cause) cause = extractFragment(sentence, CAUSE_MARKERS);
      if (!resolution) resolution = extractFragment(sentence, RESOLUTION_MARKERS);
      if (cause && resolution) break;
    }
  }

  return {
    cause: cause ? clip(cause, CAUSAL_BREADCRUMB_MAX) : null,
    resolution: resolution ? clip(resolution, CAUSAL_BREADCRUMB_MAX) : null,
  };
};

/**
 * Synthesize a one-line summary for a conversational turn.
 * No LLM — purely algorithmic compression.
 *
 * V2: includes causal information when available (cause → resolution → actions).
 * Falls back to V1 format when no causal chain is found.
 */
const synthesizeTurnSummary = (
  userText: string | null,
  toolActions: string[],
  causalChain: { cause: string | null; resolution: string | null } = { cause: null, resolution: null },
): string => {
  const parts: string[] = [];

  // What was asked (truncated aggressively for HCA zone)
  if (userText && userText.length > 3) {
    parts.push(clip(userText, 50));
  }

  // Causal chain: cause → resolution (before actions)
  const hasCausal = causalChain.cause || causalChain.resolution;
  if (hasCausal) {
    if (causalChain.cause) parts.push(causalChain.cause);
    if (causalChain.resolution) parts.push(causalChain.resolution);
  }

  // Key actions — dedup and cap
  const uniqueActions = [...new Set(toolActions)].slice(0, 5);
  if (uniqueActions.length > 0) {
    const edits = uniqueActions.filter(a => a.startsWith("edited"));
    const others = uniqueActions.filter(a => !a.startsWith("edited"));
    if (edits.length > 0 && others.length <= 2) {
      parts.push(uniqueActions.join(", "));
    } else if (edits.length > 0) {
      parts.push(edits.join(", "));
      if (others.length > 0) parts.push(`+${others.length} more`);
    } else {
      parts.push(uniqueActions.join(", "));
    }
  }

  return parts.join(" \u2192 ") || "(no actions)";
};

/**
 * Build a causal breadcrumb for a turn summary line.
 * Format: "file|resolution-key" instead of just "file" or keywords.
 *
 * Deterministic: same input always produces the same breadcrumb.
 * Idempotent: the breadcrumb is a pure function of the line text and causal chain.
 */
const buildCausalBreadcrumb = (
  turnSummary: string,
  causalChain: { cause: string | null; resolution: string | null },
): string => {
  // Extract file from action part (after →)
  const fileMatch = turnSummary.match(/(?:edited |read |wrote |created |deleted )?([^\s→.]+\.\w{1,12})/);
  const file = fileMatch ? shortenPath(fileMatch[1]) : null;

  // Build resolution key from causal chain using stop-word-aware refinement
  const resolutionKey = causalChain.resolution
    ? refineBreadcrumbKey(causalChain.resolution)
    : null;

  if (file && resolutionKey) return `${file}|${resolutionKey}`;
  if (resolutionKey) return resolutionKey;
  // Fallback: V1 breadcrumb logic
  const beforeArrow = turnSummary.split("\u2192")[0].trim();
  const words = beforeArrow.split(/\s+/).filter(w => w.length > 2).slice(0, 3);
  if (words.length > 0) return words.join(" ");
  if (file) return file;
  return "";
};

/**
 * Identify conversational turns and produce one-liner summaries.
 *
 * Each turn starts at a user/bash block and continues through assistant
 * responses, tool calls, and tool results until the next user/bash block.
 * This is the HCA zone — the heaviest compression layer that covers turns
 * that would otherwise fall off the brief transcript's capBrief cutoff.
 *
 * V2: extracts causal chains from assistant text and includes them in
 * turn summaries. Causal breadcrumbs are emitted for the ...recall system.
 */
export const identifyTurns = (blocks: NormalizedBlock[]): TurnInfo[] => {
  const turns: TurnInfo[] = [];
  let currentUserText: string | null = null;
  const toolActions: string[] = [];
  const assistantTexts: string[] = [];

  const flush = () => {
    if (currentUserText === null && toolActions.length === 0) return;

    // Extract causal chain from collected assistant text in this turn
    const combinedAssistant = assistantTexts.join(" ");
    const causalChain = extractCausalChain(combinedAssistant);

    turns.push({
      summary: synthesizeTurnSummary(currentUserText, toolActions, causalChain),
    });
    currentUserText = null;
    toolActions.length = 0;
    assistantTexts.length = 0;
  };

  for (const b of blocks) {
    if (b.kind === "user" || b.kind === "bash") {
      flush();
      currentUserText = b.kind === "user"
        ? truncateTokens(collapseSkillText(b.text), 12)
        : `$ ${compressBash(b.command)}`;
      continue;
    }
    if (b.kind === "assistant") {
      // Collect assistant text for causal extraction
      if (b.text && b.text.trim().length > 0) {
        assistantTexts.push(b.text.trim());
      }
    }
    if (b.kind === "tool_call") {
      if (!b.name || b.name.trim() === "") continue;
      const path = extractPath(b.args);
      const isWrite = WRITE_TOOLS.has(b.name);
      if (isWrite && path) {
        toolActions.push(`edited ${shortenPath(path)}`);
      } else if (path) {
        toolActions.push(`${b.name.toLowerCase()} ${shortenPath(path)}`);
      } else if (b.name === "bash" || b.name === "Bash") {
        const raw = (b.args.command ?? "") as string;
        const cmd = compressBash(raw);
        if (cmd) toolActions.push(`ran ${cmd}`);
      } else {
        toolActions.push(b.name.toLowerCase());
      }
    }
  }
  flush();

  return turns;
};