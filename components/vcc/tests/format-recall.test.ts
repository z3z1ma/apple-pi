import { describe, it, expect } from "bun:test";
import { formatRecallOutput } from "../src/core/format-recall";
import type { SearchHit } from "../src/core/search-entries";

describe("formatRecallOutput", () => {
  it("shows no-match message with query", () => {
    const r = formatRecallOutput([], "xyz");
    expect(r).toContain('No matches for "xyz"');
  });

  it("shows no-entries message without query", () => {
    expect(formatRecallOutput([])).toContain("No entries");
  });

  describe("browse mode (no query)", () => {
    it("formats entries with index and role", () => {
      const entries: SearchHit[] = [
        { index: 0, role: "user", summary: "hello" },
      ];
      const r = formatRecallOutput(entries);
      expect(r).toContain("#0 [user] hello");
    });

    it("shows session history header", () => {
      const entries: SearchHit[] = [
        { index: 0, role: "user", summary: "a" },
        { index: 1, role: "assistant", summary: "b" },
      ];
      const r = formatRecallOutput(entries);
      expect(r).toContain("Session history (2 entries)");
    });
  });

  describe("search mode (with query)", () => {
    it("shows match count with query", () => {
      const entries: SearchHit[] = [
        { index: 2, role: "assistant", summary: "done", snippet: "done" },
      ];
      const r = formatRecallOutput(entries, "done");
      expect(r).toContain('Found 1 matches for "done"');
    });

    it("groups entries into segments by turn", () => {
      // Segments are split on user/bash boundaries
      const entries: SearchHit[] = [
        // Segment 1: user + assistant + tool_result (only user matches)
        { index: 0, role: "user", summary: "fix auth", snippet: "fix auth" },
        { index: 1, role: "assistant", summary: "checking...", snippet: undefined },
        { index: 2, role: "tool_result", summary: "file not found", snippet: undefined },
        // Segment 2: second user turn (assistant matches)
        { index: 3, role: "user", summary: "check the logs", snippet: undefined },
        { index: 4, role: "assistant", summary: "found the auth bug", snippet: "auth bug" },
      ];
      const r = formatRecallOutput(entries, "auth");
      expect(r).toContain("--- #0-#2 (1/3 entries match) ---");
      expect(r).toContain("> #0 [user] fix auth");
      expect(r).toContain("  #1 [assistant] checking...");
      expect(r).toContain("--- #3-#4 (1/2 entries match) ---");
      expect(r).toContain("> #4 [assistant] auth bug");
    });

    it("shows segment context for adjacent turns", () => {
      // Single match — adjacent segments shown as context
      const entries: SearchHit[] = [
        { index: 0, role: "user", summary: "hello", snippet: undefined },
        { index: 1, role: "assistant", summary: "hi", snippet: undefined },
        { index: 2, role: "user", summary: "fix auth", snippet: "fix auth" },
        { index: 3, role: "assistant", summary: "done", snippet: undefined },
        { index: 4, role: "user", summary: "thanks", snippet: undefined },
      ];
      const r = formatRecallOutput(entries, "auth");
      expect(r).toMatch(/---/);
      expect(r).toContain("fix auth");
    });

    it("handles entries without snippet (assume all matched)", () => {
      const entries: SearchHit[] = [
        { index: 0, role: "user", summary: "hello" },
        { index: 1, role: "assistant", summary: "world" },
      ];
      const r = formatRecallOutput(entries, "search term");
      expect(r).toContain('Found 2 matches for "search term"');
      expect(r).toContain("> #0 [user] hello");
      expect(r).toContain("> #1 [assistant] world");
    });
  });
});
