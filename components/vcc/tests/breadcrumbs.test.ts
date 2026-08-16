import { describe, it, expect } from "bun:test";
import { compile } from "../src/core/summarize";
import { buildSections } from "../src/core/build-sections";
import type { NormalizedBlock } from "../src/types";
import {
  userMsg,
} from "./fixtures";

describe("breadcrumbs: mergeHeaderSection", () => {
  it("leaves recall breadcrumbs when Session Goal exceeds cap", () => {
    const goals = Array.from({ length: 10 }, (_, i) =>
      `- Implement feature ${i}: auth${i} module`
    ).join("\n");
    const prevSummary = `[Session Goal]\n${goals}\n\n---\n\n[user]\nhi`;
    const r = compile({
      messages: [userMsg("continue")],
      previousSummary: prevSummary,
    });
    expect(r).toContain("...recall:");
    expect(r).toContain("auth0");
    expect(r).toContain("auth1");
    expect(r).toContain("feature 9");
    expect(r).not.toContain("Implement feature 0: auth0 module");
  });

  it("leaves no breadcrumbs when under cap", () => {
    const goals = Array.from({ length: 5 }, (_, i) =>
      `- Goal ${i}`
    ).join("\n");
    const prevSummary = `[Session Goal]\n${goals}\n\n---\n\n[user]\nhi`;
    const r = compile({
      messages: [userMsg("continue")],
      previousSummary: prevSummary,
    });
    expect(r).not.toContain("...recall:");
  });

  it("leaves breadcrumbs for Earlier Turns when cap exceeded", () => {
    const turns = Array.from({ length: 20 }, (_, i) =>
      `- Fix bug ${i} → edited bug${i}.ts`
    ).join("\n");
    const prevSummary = `[Earlier Turns]\n${turns}\n\n---\n\n[user]\nhi`;
    const r = compile({
      messages: [userMsg("next")],
      previousSummary: prevSummary,
    });
    expect(r).toContain("...recall:");
    expect(r).toContain("bug0.ts");
  });

  it("breadcrumb extraction: picks up file paths from edited actions", () => {
    const manyTurns = Array.from({ length: 18 }, (_, i) =>
      `- Turn ${i} → edited file${i}.ts`
    ).join("\n");
    const bigPrevSummary = `[Earlier Turns]\n${manyTurns}\n\n---\n\n[user]\ngo`;
    const r = compile({
      messages: [userMsg("continue")],
      previousSummary: bigPrevSummary,
    });
    expect(r).toContain("...recall:");
    expect(r).toContain("file0.ts");
  });

  it("breadcrumb from short text uses first content words", () => {
    const manyGoals = Array.from({ length: 10 }, (_, i) =>
      `- Task ${i} description`
    ).join("\n");
    const bigPrev = `[Session Goal]\n${manyGoals}\n\n---\n\n[user]\ngo`;
    const r = compile({
      messages: [userMsg("continue")],
      previousSummary: bigPrev,
    });
    expect(r).toContain("...recall:");
    expect(r).toContain("Task");
  });
});

describe("breadcrumbs: mergeFileLines (+recall:)", () => {
  it("replaces (+N more) with +recall: listing omitted paths", () => {
    const paths = Array.from({ length: 12 }, (_, i) => `src/mod${i}.ts`);
    const prevSummary = [
      "[Files And Changes]",
      `- Modified: ${paths.join(", ")}`,
    ].join("\n") + "\n\n---\n\n[user]\ngo";
    const r = compile({
      messages: [userMsg("continue")],
      previousSummary: prevSummary,
    });
    expect(r).toContain("+recall:");
    expect(r).toContain("mod10.ts");
    expect(r).toContain("mod11.ts");
  });

  it("no breadcrumb when all paths fit within cap", () => {
    const paths = ["src/a.ts", "src/b.ts"];
    const prevSummary = [
      "[Files And Changes]",
      `- Modified: ${paths.join(", ")}`,
    ].join("\n") + "\n\n---\n\n[user]\ngo";
    const r = compile({
      messages: [userMsg("continue")],
      previousSummary: prevSummary,
    });
    expect(r).not.toContain("+recall:");
  });

  it("breadcrumb paths are parseable on next compaction", () => {
    const prevSummary = [
      "[Files And Changes]",
      `- Modified: src/mod0.ts, src/mod1.ts, +recall: src/mod2.ts`,
    ].join("\n") + "\n\n---\n\n[user]\ngo";
    const r = compile({
      messages: [userMsg("continue")],
      previousSummary: prevSummary,
    });
    expect(r).toContain("mod2.ts");
  });

  it("applies +recall: cap even when only previous has files (no fresh)", () => {
    const paths = Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`);
    const prevSummary = [
      "[Files And Changes]",
      `- Read: ${paths.join(", ")}`,
    ].join("\n") + "\n\n---\n\n[user]\ngo";
    const r = compile({
      messages: [userMsg("continue")],
      previousSummary: prevSummary,
    });
    expect(r).toContain("+recall:");
    expect(r).toContain("file10.ts");
  });
});

describe("breadcrumbs: capBrief", () => {
  it("shows omitted count without redundant recall terms", () => {
    const longTranscript = Array.from({ length: 200 }, (_, i) =>
      `[user]\nmessage ${i}`
    ).join("\n\n");
    const previousSummary = `[Session Goal]\n- goal\n\n---\n\n${longTranscript}`;
    const r = compile({
      previousSummary,
      messages: [userMsg("latest")],
    });
    expect(r).toContain("earlier lines omitted");
    // capBrief should NOT include recall: terms (redundant with Files And Changes)
    expect(r).not.toMatch(/\.\.\.\(\d+ earlier lines omitted, recall:/);
  });
});

describe("breadcrumbs: type catalog", () => {
  it("emits count-only message for omitted files (not redundant file list)", () => {
    const blocks: NormalizedBlock[] = [];
    for (let i = 0; i < 15; i++) {
      blocks.push({ kind: "tool_call", name: "Read", args: { file_path: `src/file${i}.ts` } });
      blocks.push({
        kind: "tool_result",
        name: "Read",
        text: Array.from({ length: 3 }, (_, j) =>
          `export function fn${i}_${j}(): void {}`
        ).join("\n"),
        isError: false,
      });
    }
    const r = buildSections({ blocks });
    // Should contain count-only message, not redundant file list
    expect(r.typeCatalog.some(l => /more files with signatures omitted/.test(l))).toBe(true);
    // Should NOT list specific file names in the omission line (redundant with Files And Changes)
    expect(r.typeCatalog.every(l => !l.includes("recall:"))).toBe(true);
  });

  it("no omission line when all files fit within sig cap", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Read", args: { file_path: "src/a.ts" } },
      {
        kind: "tool_result",
        name: "Read",
        text: "export function fnA(): void {}",
        isError: false,
      },
    ];
    const r = buildSections({ blocks });
    expect(r.typeCatalog.every(l => !l.includes("omitted"))).toBe(true);
  });
});

describe("breadcrumbs: no redundancy across sections", () => {
  it("Anchors section removed entirely (was redundant with Commits + Outstanding Context)", () => {
    // Anchors duplicates commit hashes from [Commits] and error IDs from [Outstanding Context]
    // The section has been removed entirely.
    const blocks: NormalizedBlock[] = [];
    for (let i = 0; i < 5; i++) {
      blocks.push({ kind: "tool_call", name: "Read", args: { file_path: `src/file${i}.ts` } });
      blocks.push({
        kind: "tool_result",
        name: "Read",
        text: "export function fn(): void {}",
        isError: false,
      });
    }
    const r = buildSections({ blocks });
    expect(r).not.toHaveProperty("anchors");
  });

  it("Current Status section removed entirely (redundant with brief transcript + Files And Changes)", () => {
    // "Working on:" = last user message (brief transcript)
    // "Last action:" = file path (Files And Changes)
    // "Next:" = assistant text (brief transcript)
    const blocks: NormalizedBlock[] = [];
    const r = buildSections({ blocks });
    expect(r).not.toHaveProperty("currentStatus");
  });
});

describe("breadcrumbs: determinism and idempotency", () => {
  it("compile produces identical output for identical inputs", () => {
    const goals = Array.from({ length: 10 }, (_, i) =>
      `- Goal ${i} with detail`
    ).join("\n");
    const prevSummary = `[Session Goal]\n${goals}\n\n---\n\n[user]\nhi`;

    const input = {
      messages: [userMsg("continue")],
      previousSummary: prevSummary,
    };

    const r1 = compile(input);
    const r2 = compile(input);
    expect(r1).toBe(r2);
  });

  it("breadcrumbs are deterministic: same dropped content produces same breadcrumb", () => {
    const goals = Array.from({ length: 10 }, (_, i) =>
      `- Implement feature ${i}: module${i}`
    ).join("\n");
    const prevSummary = `[Session Goal]\n${goals}\n\n---\n\n[user]\nhi`;

    const r1 = compile({ messages: [userMsg("continue")], previousSummary: prevSummary });
    const r2 = compile({ messages: [userMsg("continue")], previousSummary: prevSummary });

    expect(r1).toBe(r2);
    const recallLine1 = r1.split("\n").find(l => l.includes("...recall:"));
    const recallLine2 = r2.split("\n").find(l => l.includes("...recall:"));
    expect(recallLine1).toBe(recallLine2);
  });

  it("prior compaction breadcrumb lines survive across compactions", () => {
    const prevSummary = [
      "[Session Goal]",
      "- ...recall: auth0, auth1",
      "- Goal 2",
      "- Goal 3",
      "- Goal 4",
      "- Goal 5",
      "- Goal 6",
      "- Goal 7",
      "- Goal 8",
      "- Goal 9",
    ].join("\n") + "\n\n---\n\n[user]\nhi";
    const r = compile({
      messages: [userMsg("continue")],
      previousSummary: prevSummary,
    });
    // The breadcrumb from the prior compaction should be preserved
    expect(r).toContain("auth0");
    expect(r).toContain("auth1");
  });

  it("double-compilation of same previous summary is idempotent", () => {
    const goals = Array.from({ length: 10 }, (_, i) =>
      `- Goal ${i} with detail`
    ).join("\n");
    const prevSummary = `[Session Goal]\n${goals}\n\n---\n\n[user]\nhi`;

    const intermediate = compile({
      messages: [userMsg("continue")],
      previousSummary: prevSummary,
    });

    const recallNoteIdx = intermediate.lastIndexOf("Use `vcc_recall`");
    const stripped = recallNoteIdx >= 0
      ? intermediate.slice(0, recallNoteIdx).replace(/\s*(?:\n\n---\n\n)?\s*$/, "").trimEnd()
      : intermediate;

    const r1 = compile({
      messages: [userMsg("more work")],
      previousSummary: stripped,
    });
    const r2 = compile({
      messages: [userMsg("more work")],
      previousSummary: stripped,
    });
    expect(r1).toBe(r2);
  });

  it("buildSections type catalog is deterministic", () => {
    const blocks: NormalizedBlock[] = [];
    for (let i = 0; i < 15; i++) {
      blocks.push({ kind: "tool_call", name: "Read", args: { file_path: `src/file${i}.ts` } });
      blocks.push({
        kind: "tool_result",
        name: "Read",
        text: Array.from({ length: 3 }, (_, j) =>
          `export function fn${i}_${j}(): void {}`
        ).join("\n"),
        isError: false,
      });
    }
    const r1 = buildSections({ blocks });
    const r2 = buildSections({ blocks });
    expect(r1.typeCatalog).toEqual(r2.typeCatalog);
  });
});
