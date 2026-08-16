import { describe, it, expect } from "bun:test";
import { buildSections } from "../src/core/build-sections";
import type { NormalizedBlock } from "../src/types";

describe("outstanding context: deep error extraction", () => {
  it("captures bash non-zero exit codes", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "bash", command: "npm test", output: "1 failed", exitCode: 1 },
    ];
    const r = buildSections({ blocks });
    expect(r.outstandingContext.length).toBeGreaterThan(0);
    expect(r.outstandingContext[0]).toContain("bash:exit 1");
    expect(r.outstandingContext[0]).toContain("npm test");
  });

  it("captures bash non-zero exit code with output context", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "bash", command: "cargo build", output: "error: could not compile", exitCode: 101 },
    ];
    const r = buildSections({ blocks });
    expect(r.outstandingContext.length).toBeGreaterThan(0);
    expect(r.outstandingContext[0]).toContain("bash:exit 101");
    expect(r.outstandingContext[0]).toContain("cargo build");
    expect(r.outstandingContext[0]).toContain("could not compile");
  });

  it("skips bash with exit code 0", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "bash", command: "echo ok", output: "ok", exitCode: 0 },
    ];
    const r = buildSections({ blocks });
    expect(r.outstandingContext).toEqual([]);
  });

  it("skips bash with undefined exit code", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "bash", command: "echo ok", output: "ok", exitCode: undefined },
    ];
    const r = buildSections({ blocks });
    expect(r.outstandingContext).toEqual([]);
  });

  it("captures TypeScript compiler errors", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "bash", command: "tsc --noEmit", output: "src/auth.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.", exitCode: 0 },
    ];
    const r = buildSections({ blocks });
    expect(r.outstandingContext.length).toBeGreaterThan(0);
    expect(r.outstandingContext.some(c => c.includes("[tsc]"))).toBe(true);
    expect(r.outstandingContext.some(c => c.includes("TS2322"))).toBe(true);
  });

  it("captures test failures in bash output", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "bash", command: "bun test", output: "2 failed\nFAIL auth.test.ts", exitCode: 1 },
    ];
    const r = buildSections({ blocks });
    expect(r.outstandingContext.length).toBeGreaterThan(0);
    // Should capture both the exit code AND the test failure signal
    const hasExitCode = r.outstandingContext.some(c => c.includes("bash:exit 1"));
    const hasTests = r.outstandingContext.some(c => c.includes("[tests]"));
    expect(hasExitCode || hasTests).toBe(true);
  });

  it("captures empty grep results", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "grep", args: { pattern: "verifyToken", path: "src/" } },
      { kind: "tool_result", name: "grep", text: "No matches found", isError: false },
    ];
    const r = buildSections({ blocks });
    expect(r.outstandingContext.length).toBeGreaterThan(0);
    expect(r.outstandingContext[0]).toContain("[no matches]");
    expect(r.outstandingContext[0]).toContain("grep");
    expect(r.outstandingContext[0]).toContain("verifyToken");
  });

  it("captures empty glob results", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "glob", args: { pattern: "**/*.proto" } },
      { kind: "tool_result", name: "glob", text: "No files matched.", isError: false },
    ];
    const r = buildSections({ blocks });
    expect(r.outstandingContext.length).toBeGreaterThan(0);
    expect(r.outstandingContext[0]).toContain("[no matches]");
    expect(r.outstandingContext[0]).toContain("glob");
  });

  it("captures tsc errors from tool_result with bash error", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_result", name: "bash", text: "src/utils.ts(5,1): error TS2305: Module has no exported member 'foo'.", isError: true },
    ];
    const r = buildSections({ blocks });
    expect(r.outstandingContext.length).toBeGreaterThan(0);
    expect(r.outstandingContext.some(c => c.includes("[tsc]"))).toBe(true);
  });

  it("still captures BLOCKER_RE text from assistant", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "assistant", text: "The deployment is still failing because of the auth configuration." },
    ];
    const r = buildSections({ blocks });
    expect(r.outstandingContext.length).toBeGreaterThan(0);
    expect(r.outstandingContext[0]).toContain("still failing");
  });

  it("deduplicates error items", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_result", name: "bash", text: "Command not found", isError: true },
      { kind: "tool_result", name: "bash", text: "Command not found", isError: true },
    ];
    const r = buildSections({ blocks });
    const matchCount = r.outstandingContext.filter(c => c.includes("Command not found")).length;
    expect(matchCount).toBeLessThanOrEqual(1);
  });
});

describe("files and changes: no symbol annotations (moved to Type Catalog)", () => {
  it("lists modified files without symbol annotations", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Edit", args: { file_path: "auth.ts", newText: "export function login() {}\nexport function verifyToken() {}\nconst _internal = 1;" } },
      { kind: "tool_result", name: "Edit", text: "ok", isError: false },
    ];
    const r = buildSections({ blocks });
    expect(r.filesAndChanges.length).toBeGreaterThan(0);
    expect(r.filesAndChanges[0]).toContain("Modified");
    expect(r.filesAndChanges[0]).toContain("auth.ts");
    // Symbol annotations removed from Files And Changes (redundant with Type Catalog)
    expect(r.filesAndChanges[0]).not.toContain("(");
    // Symbols should appear in the Type Catalog instead
    expect(r.typeCatalog.some(l => l.includes("login"))).toBe(true);
    expect(r.typeCatalog.some(l => l.includes("verifyToken"))).toBe(true);
  });

  it("lists read files without symbol annotations", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Read", args: { file_path: "types.ts" } },
      { kind: "tool_result", name: "Read", text: "export interface User { name: string; }\nexport type AuthPayload = { email: string; }", isError: false },
    ];
    const r = buildSections({ blocks });
    expect(r.filesAndChanges.length).toBeGreaterThan(0);
    expect(r.filesAndChanges[0]).toContain("Read");
    expect(r.filesAndChanges[0]).toContain("types.ts");
    // Symbol annotations removed (redundant with Type Catalog)
    expect(r.filesAndChanges[0]).not.toContain("(");
    // Symbols should appear in the Type Catalog instead
    expect(r.typeCatalog.some(l => l.includes("interface User"))).toBe(true);
  });

  it("lists files without annotations when no symbols are found", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Read", args: { file_path: "config.json" } },
      { kind: "tool_result", name: "Read", text: '{ "name": "test" }', isError: false },
    ];
    const r = buildSections({ blocks });
    expect(r.filesAndChanges[0]).toContain("config.json");
    expect(r.filesAndChanges[0]).not.toContain("(");
  });

  it("handles Mixed Edit+Read: Modified takes priority", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Read", args: { file_path: "utils.ts" } },
      { kind: "tool_result", name: "Read", text: "export function helper() {}\nexport class Util {}", isError: false },
      { kind: "tool_call", name: "Edit", args: { file_path: "utils.ts", newText: "export function newHelper() {}" } },
      { kind: "tool_result", name: "Edit", text: "ok", isError: false },
    ];
    const r = buildSections({ blocks });
    expect(r.filesAndChanges[0]).toContain("Modified");
    expect(r.filesAndChanges[0]).toContain("utils.ts");
    // Full signatures in Type Catalog, not in Files And Changes
    expect(r.typeCatalog.some(l => l.includes("newHelper"))).toBe(true);
  });

  it("Python def and class exports appear in Type Catalog only", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Read", args: { file_path: "auth.py" } },
      { kind: "tool_result", name: "Read", text: "def login(email, pwd):\n    pass\n\nclass AuthProvider:\n    pass", isError: false },
    ];
    const r = buildSections({ blocks });
    expect(r.filesAndChanges[0]).toContain("auth.py");
    expect(r.filesAndChanges[0]).not.toContain("(");
    expect(r.typeCatalog.some(l => l.includes("login"))).toBe(true);
    expect(r.typeCatalog.some(l => l.includes("AuthProvider"))).toBe(true);
  });

  it("Go exported functions appear in Type Catalog only", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Read", args: { file_path: "handler.go" } },
      { kind: "tool_result", name: "Read", text: "func HandleRequest(w http.ResponseWriter, r *http.Request) {\n\t// ...\n}\n\nfunc internalHelper() {}", isError: false },
    ];
    const r = buildSections({ blocks });
    expect(r.filesAndChanges[0]).toContain("handler.go");
    expect(r.typeCatalog.some(l => l.includes("HandleRequest"))).toBe(true);
    // unexported Go functions (lowercase) should not be included
    expect(r.typeCatalog.every(l => !l.includes("internalHelper"))).toBe(true);
  });
});

describe("type catalog", () => {
  it("extracts exported signatures from modified files", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Edit", args: { file_path: "auth.ts", newText: "export function login(email: string, pwd: string): Promise<Session> {\n  // impl\n}" } },
      { kind: "tool_result", name: "Edit", text: "ok", isError: false },
    ];
    const r = buildSections({ blocks });
    expect(r.typeCatalog.length).toBeGreaterThan(0);
    expect(r.typeCatalog[0]).toContain("auth.ts");
    expect(r.typeCatalog.some(l => l.includes("login"))).toBe(true);
  });

  it("extracts exported signatures from Read results", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Read", args: { file_path: "types.ts" } },
      { kind: "tool_result", name: "Read", text: "export interface User {\n  name: string;\n  email: string;\n}\n\nexport type Session = {\n  token: string;\n  user: User;\n}", isError: false },
    ];
    const r = buildSections({ blocks });
    expect(r.typeCatalog.length).toBeGreaterThan(0);
    expect(r.typeCatalog.some(l => l.includes("interface User"))).toBe(true);
    expect(r.typeCatalog.some(l => l.includes("type Session"))).toBe(true);
  });

  it("prioritizes modified files over read files", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Read", args: { file_path: "read_only.ts" } },
      { kind: "tool_result", name: "Read", text: "export function readOnly() {}", isError: false },
      { kind: "tool_call", name: "Edit", args: { file_path: "modified.ts", newText: "export function modified() {}" } },
      { kind: "tool_result", name: "Edit", text: "ok", isError: false },
    ];
    const r = buildSections({ blocks });
    expect(r.typeCatalog.length).toBeGreaterThan(0);
    // Modified file should appear first
    expect(r.typeCatalog[0]).toContain("modified.ts");
  });

  it("returns empty for files with no exportable signatures", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Read", args: { file_path: "data.json" } },
      { kind: "tool_result", name: "Read", text: '{ "key": "value" }', isError: false },
    ];
    const r = buildSections({ blocks });
    expect(r.typeCatalog).toEqual([]);
  });

  it("caps signatures per file to 8", () => {
    const sigs = Array.from({ length: 15 }, (_, i) => `export function fn${i}(): void {}`).join("\n");
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Read", args: { file_path: "big.ts" } },
      { kind: "tool_result", name: "Read", text: sigs, isError: false },
    ];
    const r = buildSections({ blocks });
    // The catalog should have the file but max 8 signatures
    const sigLines = r.typeCatalog.filter(l => l.startsWith("  "));
    expect(sigLines.length).toBeLessThanOrEqual(8);
  });
});

describe("symbol changes", () => {
  it("extracts symbol refs from Edit/Write tool calls", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Edit", args: { file_path: "auth.ts", newText: "export function login() {}\nexport function verifyToken() {}" } },
      { kind: "tool_result", name: "Edit", text: "ok", isError: false },
    ];
    const r = buildSections({ blocks });
    expect(r.symbolChanges.length).toBeGreaterThan(0);
    expect(r.symbolChanges.some(s => s.name === "login" && s.file === "auth.ts")).toBe(true);
    expect(r.symbolChanges.some(s => s.name === "verifyToken" && s.kind === "function")).toBe(true);
  });

  it("marks read vs modified access correctly", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Read", args: { file_path: "types.ts" } },
      { kind: "tool_result", name: "Read", text: "export interface User {}", isError: false },
      { kind: "tool_call", name: "Edit", args: { file_path: "auth.ts", newText: "export function login() {}" } },
      { kind: "tool_result", name: "Edit", text: "ok", isError: false },
    ];
    const r = buildSections({ blocks });
    const loginSym = r.symbolChanges.find(s => s.name === "login");
    const userSym = r.symbolChanges.find(s => s.name === "User");
    expect(loginSym?.access).toBe("modified");
    expect(userSym?.access).toBe("read");
  });

  it("deduplicates symbols by name+file", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Read", args: { file_path: "auth.ts" } },
      { kind: "tool_result", name: "Read", text: "export function login() {}", isError: false },
      { kind: "tool_call", name: "Edit", args: { file_path: "auth.ts", newText: "export function login() {}" } },
      { kind: "tool_result", name: "Edit", text: "ok", isError: false },
    ];
    const r = buildSections({ blocks });
    const loginSymCount = r.symbolChanges.filter(s => s.name === "login" && s.file === "auth.ts").length;
    expect(loginSymCount).toBe(1);
  });
});

describe("format output integration", () => {
  it("includes Type Catalog section in formatted output between Files and Commits", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Read", args: { file_path: "types.ts" } },
      { kind: "tool_result", name: "Read", text: "export interface User { name: string; }", isError: false },
    ];
    const r = buildSections({ blocks });
    const { formatSummary } = require("../src/core/format");
    const output = formatSummary(r);
    expect(output).toContain("[Type Catalog]");
    // Should appear after Files And Changes and before Commits
    const filesIdx = output.indexOf("[Files And Changes]");
    const typeIdx = output.indexOf("[Type Catalog]");
    const commitsIdx = output.indexOf("[Commits]");
    if (filesIdx >= 0 && typeIdx >= 0) expect(filesIdx).toBeLessThan(typeIdx);
    // Commits may or may not be present
    if (commitsIdx >= 0 && typeIdx >= 0) expect(typeIdx).toBeLessThan(commitsIdx);
  });

  it("Type Catalog is volatile (fresh only) on merge", () => {
    const { compile } = require("../src/core/summarize");
    const prev = "[Session Goal]\n- goal\n\n[Type Catalog]\n- old-file.ts:\n  export function old()";
    const fresh = compile({ messages: [], previousSummary: prev });
    // Type Catalog should be fresh-only, not merged from previous
    expect(fresh).not.toContain("old-file.ts");
    expect(fresh).not.toContain("old()");
  });
});
