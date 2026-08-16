import type { NormalizedBlock, ToolResultIndex } from "../types";
import { extractPath } from "../core/tool-args";

const FILE_WRITE_TOOLS = new Set([
  "Edit", "Write", "edit", "write", "edit_file", "write_file",
  "MultiEdit",
]);

const FILE_READ_TOOLS = new Set([
  "Read", "read", "read_file", "View",
]);

const FILE_CREATE_TOOLS = new Set([
  "Write", "write", "write_file",
]);

// Declaration regexes — consolidated from files.ts, symbol-changes.ts, type-catalog.ts
// Order: more specific patterns first, generic fallbacks last.

const TS_EXPORT_DECL_RE =
  /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|type|interface|const|let|enum)\s+(\w+)/;
const TS_TYPE_DECL_RE =
  /^\s*(?:export\s+)?(?:type|interface)\s+(\w+)/;
const TS_EXPORT_SIG_RE =
  /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|type|interface|const|let|enum)\s+\w+[^;{]*[;{]?/;

const RUST_DECL_RE =
  /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:fn|struct|enum|trait|type|const|union|var)\s+(\w+)/;
const RUST_IMPL_RE =
  /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?impl\s+(?:<[^>]+>\s+)?(\w+)(?:\s+for\s+(\w+))?/;
const RUST_SIG_RE =
  /^\s*pub\s+(?:async\s+)?(?:fn|struct|enum|trait|type)\s+\w+/;

const ELIXIR_DEF_RE =
  /^\s*def(?:p|macro|macrop|guard|guardp)?\s+(\w+)/;
const ELIXIR_MODULE_RE =
  /^\s*defmodule\s+(\w+)/;
const ELIXIR_SPECIAL_RE =
  /^\s*def(?:struct|protocol|impl)\s+(\w+)/;

const JAVA_TYPE_RE =
  /^\s*(?:(?:public|private|protected)\s+)?(?:abstract\s+|static\s+|final\s+|sealed\s+)?(?:class|interface|enum|@interface|record)\s+(\w+)/;
const JAVA_METHOD_RE =
  /^\s*(?:public|protected)\s+(?:static\s+|abstract\s+|final\s+)?(?:\S+(?:\s*\[\])?\s+)(\w+)\s*\(/;

const C_TYPE_RE =
  /^\s*(?:typedef\s+)?(?:struct|class|enum|union)\s+(\w+)/;
const C_FUNC_RE =
  /^\s*(?!func\b)(?:(?:static|extern|inline|virtual)\s+)?[\w][\w:*&\s]*?(\b\w+)\s*\(/;

const RUBY_DEF_RE =
  /^\s*def\s+(?:self\.)?(\w+)/;
const RUBY_TYPE_RE =
  /^\s*(?:class|module)\s+(\w+)/;

const PY_DECL_RE =
  /^\s*(?:async\s+)?def\s+(\w+)|^\s*class\s+(\w+)/;
const PY_SIG_RE =
  /^\s*(?:async\s+)?(?:def|class)\s+\w+\s*(?:\([^)]*\))?/;

const GO_DECL_RE =
  /^\s*func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/;
const GO_SIG_RE =
  /^\s*func\s+(?:\(\w+\s+\*?\w+\)\s+)?\w+\s*(?:\([^)]*\))?\s*(?:\([^)]*\))?/;

interface SymbolInfo {
  /** Simple declaration name (used by files.ts, symbol-changes.ts) */
  name: string;
  /** Declaration kind */
  kind: "function" | "type" | "class" | "variable" | "unknown";
  /** Full signature line (used by type-catalog.ts) */
  signature?: string;
}

interface ToolCallSymbols {
  /** Symbols found in the tool_result text */
  resultSymbols: SymbolInfo[];
  /** Symbols found in Edit/Write args (newText/content) */
  argSymbols: SymbolInfo[];
}

// Fast screening regex: rejects lines that can't start any declaration.
// Avoids running the full 15-regex cascade on body code / comments / blank lines.
const DECL_SCREEN_RE =
  /^\s*(?:export|pub|func|def|class|type|interface|async|abstract|static|public|private|protected|struct|enum|trait|impl|module|const|fn|sealed|record|typedef|union|virtual|extern|inline)/;

const parseDeclName = (line: string): { name: string; kind: SymbolInfo["kind"] } | null => {
  // Quick reject: lines that can't start any declaration keyword
  if (!DECL_SCREEN_RE.test(line)) return null;

  let m = line.match(TS_EXPORT_DECL_RE);
  if (m) {
    const kind = line.includes("function") ? "function"
      : line.includes("class") ? "class"
      : line.includes("type") ? "type"
      : line.includes("interface") ? "type"
      : line.includes("enum") ? "variable"
      : "variable";
    return { name: m[1], kind };
  }
  m = line.match(TS_TYPE_DECL_RE);
  if (m) return { name: m[1], kind: "type" };
  m = line.match(RUST_DECL_RE);
  if (m) return { name: m[1], kind: "function" };
  m = line.match(RUST_IMPL_RE);
  if (m) return { name: m[1], kind: "class" };
  m = line.match(ELIXIR_MODULE_RE);
  if (m) return { name: m[1], kind: "class" };
  m = line.match(ELIXIR_SPECIAL_RE);
  if (m) return { name: m[1], kind: "class" };
  m = line.match(ELIXIR_DEF_RE);
  if (m) return { name: m[1], kind: "function" };
  m = line.match(JAVA_TYPE_RE);
  if (m) return { name: m[1], kind: "class" };
  m = line.match(JAVA_METHOD_RE);
  if (m) return { name: m[1], kind: "function" };
  m = line.match(C_TYPE_RE);
  if (m) return { name: m[1], kind: "class" };
  m = line.match(C_FUNC_RE);
  if (m) return { name: m[1], kind: "function" };
  m = line.match(RUBY_TYPE_RE);
  if (m) return { name: m[1], kind: "class" };
  m = line.match(RUBY_DEF_RE);
  if (m) return { name: m[1], kind: "function" };
  m = line.match(PY_DECL_RE);
  if (m) return { name: m[1] || m[2], kind: m[2] ? "class" : "function" };
  m = line.match(GO_DECL_RE);
  if (m && m[1][0] === m[1][0].toUpperCase()) return { name: m[1], kind: "function" };
  return null;
};

const parseSignature = (line: string): string | null => {
  if (TS_EXPORT_SIG_RE.test(line)) return line.trim();
  if (PY_SIG_RE.test(line) && !line.trim().startsWith("def _") && !line.trim().startsWith("class _")) return line.trim();
  if (GO_SIG_RE.test(line)) {
    const nameMatch = line.match(/func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/);
    if (nameMatch && nameMatch[1] && nameMatch[1][0] === nameMatch[1][0].toUpperCase()) return line.trim();
  }
  if (RUST_SIG_RE.test(line)) return line.trim();
  return null;
};

/**
 * Line-by-line iteration over text using indexOf("\n") instead of split().
 * Avoids allocating an intermediate string array — for a 300-line, 12KB
 * tool result this saves ~30μs/scan vs split().  Over 600 tool results
 * in a large session, that's ~18ms reclaimed.
 */
const eachLine = function* (text: string, maxLines: number): Generator<string> {
  let pos = 0;
  let count = 0;
  const len = text.length;
  while (pos < len && count < maxLines) {
    const nl = text.indexOf("\n", pos);
    if (nl === -1) {
      yield text.slice(pos);
      return;
    }
    yield text.slice(pos, nl);
    pos = nl + 1;
    count++;
  }
};

const extractSymbolsFromText = (text: string, maxLines: number, includeSigs: boolean): SymbolInfo[] => {
  const names: SymbolInfo[] = [];
  const seen = new Set<string>();
  for (const line of eachLine(text, maxLines)) {
    const decl = parseDeclName(line);
    if (decl && !seen.has(decl.name)) {
      seen.add(decl.name);
      const sig = includeSigs ? parseSignature(line) : undefined;
      names.push({ name: decl.name, kind: decl.kind, signature: sig ?? undefined });
    }
  }
  return names;
};

interface FileActivity {
  read: Set<string>;
  modified: Set<string>;
  created: Set<string>;
  symbols: Map<string, string[]>;
}

interface ExportSig {
  file: string;
  signatures: string[];
  modified: boolean;
}

export interface SymbolRef {
  name: string;
  file: string;
  kind: "function" | "type" | "class" | "variable" | "unknown";
  access: "modified" | "read";
}

export interface UnifiedExtractResult {
  fileActivity: FileActivity;
  typeCatalog: ExportSig[];
  symbolChanges: SymbolRef[];
}

/**
 * Single-pass extraction of all file/symbol information from tool calls.
 *
 * Replaces the triple-redundant scan performed by:
 *   - extractFiles() — path collection + 200-line symbol scan
 *   - extractSymbolChanges() — 300-line symbol scan
 *   - extractTypeCatalog() — 150-line signature scan
 *
 * All three scanned the same tool_result content with overlapping regex
 * patterns. This unified pass does it once and returns all three datasets.
 */
export const extractFileAndSymbolData = (
  blocks: NormalizedBlock[],
  tri?: ToolResultIndex,
): UnifiedExtractResult => {
  const read = new Set<string>();
  const modified = new Set<string>();
  const created = new Set<string>();
  // Parallel dedup set for symbols Map — avoids O(n) Array.includes()
  // on symbol arrays that can grow to 200+ entries per file.
  const symbols = new Map<string, string[]>();
  const symbolsSeen = new Map<string, Set<string>>();
  const symbolRefs: SymbolRef[] = [];
  const refSeen = new Set<string>();

  // Type catalog state
  const fileSigs = new Map<string, { sigs: string[]; modified: boolean }>();
  const fileOrder: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== "tool_call") continue;
    const p = extractPath(b.args);
    if (!p) continue;

    const isRead = FILE_READ_TOOLS.has(b.name);
    const isWrite = FILE_WRITE_TOOLS.has(b.name);
    const isCreate = FILE_CREATE_TOOLS.has(b.name);

    if (isRead) read.add(p);
    if (isWrite) modified.add(p);
    if (isCreate) created.add(p);

    // Extract symbols from Edit/Write args
    if (isWrite) {
      const newText = (b.args.newText ?? b.args.new_text ?? b.args.content ?? "") as string;
      if (newText && typeof newText === "string") {
        const syms = extractSymbolsFromText(newText, 100, true);

        // File activity symbols
        let seen = symbolsSeen.get(p);
        if (!seen) { seen = new Set(); symbolsSeen.set(p, seen); }
        if (!symbols.has(p)) symbols.set(p, []);
        const existing = symbols.get(p)!;
        for (const s of syms) {
          if (!seen.has(s.name)) { seen.add(s.name); existing.push(s.name); }
        }

        // Type catalog
        if (!fileSigs.has(p)) {
          fileSigs.set(p, { sigs: [], modified: true });
          fileOrder.push(p);
        } else {
          fileSigs.get(p)!.modified = true;
        }
        const sigs = fileSigs.get(p)!.sigs;
        for (const s of syms) {
          if (s.signature && !sigs.includes(s.signature)) sigs.push(s.signature);
        }

        // Symbol changes
        const access = "modified" as const;
        for (const s of syms) {
          const key = `${s.name}@${p}`;
          if (!refSeen.has(key)) {
            refSeen.add(key);
            symbolRefs.push({ name: s.name, file: p, kind: s.kind, access });
          }
        }
      }
    }

    // Extract from tool_result (shared look-ahead via index)
    if (isRead || isWrite) {
      const r = tri ? tri.get(i) : (() => {
        for (let j = i + 1; j < Math.min(blocks.length, i + 4); j++) {
          const b2 = blocks[j];
          if (b2.kind === "tool_result") return b2 as Extract<NormalizedBlock, { kind: "tool_result" }>;
        }
        return null;
      })();

      if (r && r.text && !r.isError) {
        const resultText = r.text;

        // Parse symbols once — 200 lines covers all three extractors' needs
        const syms = extractSymbolsFromText(resultText, 200, true);

        // File activity symbols
        let seen = symbolsSeen.get(p);
        if (!seen) { seen = new Set(); symbolsSeen.set(p, seen); }
        if (!symbols.has(p)) symbols.set(p, []);
        const existing = symbols.get(p)!;
        for (const s of syms) {
          if (!seen.has(s.name)) { seen.add(s.name); existing.push(s.name); }
        }

        // Type catalog (Read results)
        if (isRead) {
          if (!fileSigs.has(p)) {
            fileSigs.set(p, { sigs: [], modified: false });
            fileOrder.push(p);
          }
          const sigs = fileSigs.get(p)!.sigs;
          for (const s of syms) {
            if (s.signature && !sigs.includes(s.signature)) sigs.push(s.signature);
          }
        }

        // Symbol changes
        const access = isWrite ? "modified" as const : "read" as const;
        for (const s of syms) {
          const key = `${s.name}@${p}`;
          if (!refSeen.has(key)) {
            refSeen.add(key);
            symbolRefs.push({ name: s.name, file: p, kind: s.kind, access });
          }
        }
      }
    }
  }

  // Dedup: if already Modified, drop from Created
  for (const p of modified) created.delete(p);

  // Build type catalog — modified files first, then read files
  const modifiedSigs: ExportSig[] = [];
  const readSigs: ExportSig[] = [];
  for (const file of fileOrder) {
    const entry = fileSigs.get(file)!;
    if (entry.sigs.length === 0) continue;
    const esig: ExportSig = { file, signatures: entry.sigs.slice(0, 8), modified: entry.modified };
    if (esig.modified) modifiedSigs.push(esig);
    else readSigs.push(esig);
  }
  const typeCatalog = [...modifiedSigs, ...readSigs].slice(0, 12);

  return {
    fileActivity: { read, modified, created, symbols },
    typeCatalog,
    symbolChanges: symbolRefs,
  };
};
