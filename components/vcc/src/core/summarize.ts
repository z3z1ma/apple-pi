import type { Message } from "@earendil-works/pi-ai";
import type { FileOps } from "../types";
import { normalize } from "./normalize";
import { filterNoise } from "./filter-noise";
import { buildSections } from "./build-sections";
import { formatSummary, capBrief, wrapLongLines } from "./format";
import { refineBreadcrumbKey } from "./causal-keys";

export interface CompileInput {
  messages: Message[];
  previousSummary?: string;
  fileOps?: FileOps;
}

// Cache-friendly order: stable sections first, volatile sections last
const HEADER_NAMES = [
  "Session Goal",
  "User Preferences",
  "Files And Changes",
  "Commits",
  "Type Catalog",
  "Outstanding Context",
  "Earlier Turns",
];

const SEPARATOR = "\n\n---\n\n";

/** Preamble prepended to every compaction summary. */
const HANDFOFF_PREAMBLE =
  "This summary captures work done before the most recent messages in this session. " +
  "Read it to pick up context — this is work already in progress. " +
  "Do not recap what was done, do not ask what to do next. " +
  "Continue directly where you left off. " +
  "Use `vcc_recall` to search for prior work, decisions, and context from before this summary.";

/** Extract a named section from summary text */
const sectionOf = (text: string, header: string): string => {
  const tag = `[${header}]`;
  const start = text.indexOf(tag);
  if (start < 0) return "";
  const after = text.slice(start);
  // Find next section header or separator
  const nextSection = HEADER_NAMES
    .filter((h) => h !== header)
    .map((h) => after.indexOf(`[${h}]`))
    .filter((n) => n > 0);
  const nextSep = after.indexOf("\n\n---\n\n");
  const candidates = [...nextSection, ...(nextSep > 0 ? [nextSep] : [])].sort((a, b) => a - b);
  const end = candidates[0];
  return (end ? after.slice(0, end) : after).trim();
};

/** Extract the brief transcript part (everything after ---) */
const briefOf = (text: string): string => {
  const idx = text.indexOf(SEPARATOR);
  if (idx < 0) return "";
  return text.slice(idx + SEPARATOR.length).trim();
};

/**
 * Extract searchable keywords from a section line for breadcrumb trails.
 *
 * Deterministic: same input always produces the same breadcrumb.
 * Idempotent: the breadcrumb is a pure function of the line text.
 */
const extractBreadcrumb = (line: string): string => {
  const text = line.replace(/^\s*-\s*/, "").trim();
  if (!text) return "";

  // V1: ...recall: breadcrumb — preserve as-is (they already carry causal keys)
  if (text.startsWith("...recall:")) return text.slice("...recall:".length).trim();

  // V2: causal breadcrumb from turn summary (contains →)
  // Format: "goal → cause_fragment → resolution_fragment → tool_actions"
  // The cause/resolution fragments are produced by extractCausalChain and
  // are typically short phrases without a leading verb.
  if (text.includes("\u2192")) {
    const parts = text.split("\u2192").map(p => p.trim());

    // Extract file from the action parts
    const fileMatch = text.match(/(?:edited |read |wrote |created |deleted )?([^\s.]+\.\w{1,12})/);
    const file = fileMatch ? fileMatch[1] : null;

    // Identify structural parts: goal is first, tool actions are at the end
    // (start with read/edited/ran or contain file paths).
    // Middle parts are causal fragments.
    const toolActionRe = /^(?:read|edited|wrote|created|deleted|ran)\s?/i;
    const toolActionIdx = parts.findIndex(p => toolActionRe.test(p) || /\+\d+ more/.test(p));

    // Causal parts are between goal (index 0) and tool actions
    const causalEnd = toolActionIdx >= 0 ? toolActionIdx : parts.length;
    const causalParts = parts.slice(1, causalEnd); // skip goal at index 0

    // The last causal part before tool actions is the resolution fragment
    // (from extractCausalChain). The one before that is the cause fragment.
    const causePart = causalParts.length >= 2 ? causalParts[0] : null;
    const resolutionPart = causalParts.length >= 1 ? causalParts[causalParts.length - 1] : null;

    // Build breadcrumb: file|resolution-key
    // Resolution key: content words from the resolution fragment, refined by shared key filter
    if (resolutionPart) {
      const resKey = refineBreadcrumbKey(resolutionPart);
      if (file && resKey) return `${file}|${resKey}`;
      if (resKey) return resKey;
    }

    // Cause key fallback
    if (causePart) {
      const causeKey = refineBreadcrumbKey(causePart);
      if (file && causeKey) return `${file}|${causeKey}`;
      if (causeKey) return causeKey;
    }

    // Final fallback for → lines: just the file
    if (file) return file;
  }

  // V1 fallback: "edited auth.ts" → "auth.ts"
  const fileMatch1 = text.match(/(?:edited |read |wrote |created |deleted )?(\S+\.\w{1,12})/);
  if (fileMatch1) return fileMatch1[1];
  // "Fix login bug → ..." → first few words before →
  const beforeArrow = text.split("\u2192")[0].trim();
  const words = beforeArrow.split(/\s+/).filter(w => w.length > 2).slice(0, 3);
  if (words.length > 0) return words.join(" ");
  // fallback: first content word
  const first = text.split(/\s+/).find(w => w.length > 2);
  return first ?? "";
};

/** Merge a header section */
const mergeHeaderSection = (header: string, prev: string, fresh: string): string => {
  // Outstanding Context, Type Catalog are volatile -- always use fresh only
  if (header === "Outstanding Context" || header === "Type Catalog") return fresh;
  if (!prev && !fresh) return "";
  // Files And Changes: always run through merge (even when only prev
  // has content) so the cap +recall breadcrumbs are applied.
  if (header === "Files And Changes") {
    return mergeFileLines(prev, fresh);
  }

  // Session Goal, User Preferences, Commits, Earlier Turns: line-level dedup, cap
  const isClean = (l: string) => l.startsWith("- ") && !l.includes("<skill") && !l.includes("</skill");
  // ...recall: breadcrumb lines from prior compactions are preserved as-is,
  // not re-processed or capped. They survive across compactions.
  const isRecallBreadcrumb = (l: string) => l.startsWith("- ...recall:");
  const prevLines = prev.split("\n").filter(isClean);
  const freshLines = fresh.split("\n").filter(isClean);
  const prevBreadcrumbs = prev.split("\n").filter(isRecallBreadcrumb);
  const freshBreadcrumbs = fresh.split("\n").filter(isRecallBreadcrumb);
  const allBreadcrumbs = [...new Set([...prevBreadcrumbs, ...freshBreadcrumbs])];
  const contentLines = [...new Set([...prevLines.filter(l => !isRecallBreadcrumb(l)), ...freshLines.filter(l => !isRecallBreadcrumb(l))])];
  const CAP = header === "Session Goal" ? 8 : header === "Commits" ? 8 : header === "Earlier Turns" ? 15 : 15;
  if (contentLines.length > CAP) {
    const kept = contentLines.slice(-CAP);
    const dropped = contentLines.slice(0, contentLines.length - CAP);
    const crumbs = dropped.map(extractBreadcrumb).filter(Boolean);
    const headerLine = `[${header}]`;
    // Merge new crumbs with existing breadcrumbs (dedup by extracting terms)
    const allCrumbs = crumbs.length > 0 ? [...allBreadcrumbs, `- ...recall: ${crumbs.join(", ")}`] : allBreadcrumbs;
    if (allCrumbs.length > 0) {
      return `${headerLine}\n${allCrumbs.join("\n")}\n${kept.join("\n")}`;
    }
    return `${headerLine}\n${kept.join("\n")}`;
  }
  if (contentLines.length === 0 && allBreadcrumbs.length === 0) return "";
  const parts: string[] = [];
  if (allBreadcrumbs.length > 0) parts.push(...allBreadcrumbs);
  if (contentLines.length > 0) parts.push(...contentLines);
  return `[${header}]\n${parts.join("\n")}`;
};

/** Merge Files And Changes by category, dedup paths across compactions */
const mergeFileLines = (prev: string, fresh: string): string => {
  const categories = ["Modified", "Created", "Read"] as const;
  const merged: Record<string, Set<string>> = {};
  for (const cat of categories) merged[cat] = new Set();

  // Parse "- Modified: a, b, c (+N more)" lines from both prev and fresh
  // Also handle symbol-annotated format: "- Modified: a (fn1, fn2), b"
  // Also handle breadcrumb format: "path1, +recall: path2, path3"
  for (const text of [prev, fresh]) {
    if (!text) continue;
    for (const line of text.split("\n")) {
      for (const cat of categories) {
        const prefix = `- ${cat}: `;
        if (!line.startsWith(prefix)) continue;
        let rest = line.slice(prefix.length);
        // Strip symbol annotations like " (fn1, fn2)" from each path
        rest = rest.replace(/\s*\([^)]*\)/g, "");
        // Strip "(+N more)" suffix
        rest = rest.replace(/\s*\(\+\d+ more\)\s*$/, "");
        // Strip breadcrumb marker so paths after it are parsed
        rest = rest.replace(/,\s*\+recall:\s*/, ", ");
        for (const p of rest.split(",")) {
          const trimmed = p.trim();
          // Skip breadcrumb markers that survived the replace
          if (trimmed.startsWith("+recall:")) continue;
          if (trimmed) merged[cat].add(trimmed);
        }
      }
    }
  }

  // Dedup: if already in Modified, drop from Created (file existed before)
  for (const p of merged.Modified) merged.Created.delete(p);

  const cap = (set: Set<string>, limit: number) => {
    const arr = [...set];
    if (arr.length <= limit) return arr.join(", ");
    const kept = arr.slice(0, limit);
    const omitted = arr.slice(limit);
    return kept.join(", ") + `, +recall: ${omitted.join(", ")}`;
  };

  const lines: string[] = [];
  if (merged.Modified.size > 0) lines.push(`- Modified: ${cap(merged.Modified, 10)}`);
  if (merged.Created.size > 0) lines.push(`- Created: ${cap(merged.Created, 10)}`);
  if (merged.Read.size > 0) lines.push(`- Read: ${cap(merged.Read, 10)}`);
  if (lines.length === 0) return "";
  return `[Files And Changes]\n${lines.join("\n")}`;
};

const mergeBriefTranscript = (prev: string, fresh: string): string => {
  if (!prev) return fresh;
  if (!fresh) return prev;
  return prev + "\n\n" + fresh;
};

const mergePrevious = (prev: string, fresh: string): string => {
  // Merge header sections
  const headers = HEADER_NAMES
    .map((header) => {
      const freshSec = sectionOf(fresh, header);
      const prevSec = sectionOf(prev, header);
      return mergeHeaderSection(header, prevSec, freshSec);
    })
    .filter(Boolean);

  // Merge brief transcript
  const prevBrief = briefOf(prev);
  const freshBrief = briefOf(fresh);
  const mergedBrief = mergeBriefTranscript(prevBrief, freshBrief);

  const parts: string[] = [];
  if (headers.length > 0) {
    parts.push(headers.join("\n\n"));
  }
  if (mergedBrief) {
    parts.push(capBrief(mergedBrief));
  }

  return parts.join(SEPARATOR);
};

export const compile = (input: CompileInput): string => {
  const blocks = filterNoise(normalize(input.messages));
  const data = buildSections({ blocks });
  const fresh = formatSummary(data);
  // Strip any legacy RECALL_NOTE baked into prev summary (pre-fix format)
  // so merge doesn't re-stack it inside the brief.
  const prev = input.previousSummary
    ? stripRecallNote(input.previousSummary)
    : undefined;
  const merged = prev ? mergePrevious(prev, fresh) : fresh;
  if (!merged) return "";
  const body = merged;
  return wrapLongLines(HANDFOFF_PREAMBLE + "\n\n" + body);
};

const stripRecallNote = (text: string): string => {
  // Strip leading preamble (HANDFOFF_PREAMBLE) that compile() prepends to every output.
  // When the output from one compaction becomes the previousSummary for the next,
  // the preamble must be removed so mergePrevious only sees the actual sections.
  //
  // Also handles legacy format where RECALL_NOTE was a trailing --- block
  // (before the preamble merge). Both shapes can appear in the same text
  // (old format had a leading preamble AND a trailing RECALL_NOTE). Both must
  // be stripped so the merge only sees clean section data.

  let result = text;

  // 1. Leading preamble (current format): "This summary captures..."
  if (result.startsWith("This summary captures work done before")) {
    // Find the end of the preamble paragraph (first section header or double newline)
    const headerStart = result.indexOf("[");
    if (headerStart > 0) {
      result = result.slice(headerStart).trim();
    } else {
      const doubleNL = result.indexOf("\n\n");
      if (doubleNL > 0) result = result.slice(doubleNL + 2).trim();
    }
  }

  // 2. Trailing legacy RECALL_NOTE (pre-preamble-merge format)
  //    Old format appended RECALL_NOTE as a separate --- block at the end.
  //    After step 1 strips the leading preamble, the trailing block survives.
  //    Must be stripped so it doesn't get merged into the brief transcript.
  const legacyRecall = "Use `vcc_recall` to search for prior work, decisions, and context from before this summary.";
  const legacyIdx = result.lastIndexOf(legacyRecall);
  if (legacyIdx > 0) {
    result = result.slice(0, legacyIdx).replace(/\s*(?:\n\n---\n\n)?\s*$/, "").trimEnd();
  }

  return result;
};
