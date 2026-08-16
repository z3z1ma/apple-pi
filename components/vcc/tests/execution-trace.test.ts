import { describe, expect, it } from "bun:test";
import { executionOperationsOf, executionResultText } from "../src/core/execution-trace";
import { normalize } from "../src/core/normalize";
import { renderMessage } from "../src/core/render-entries";
import { searchEntries } from "../src/core/search-entries";
import { compile } from "../src/core/summarize";

const traceDetails = {
  success: true,
  trace: {
    kind: "pi-fabric.execution",
    version: 1,
    outcome: "succeeded",
    phases: [],
    counts: {
      droppedValues: 0,
      truncatedValues: 0,
      redactedValues: 0,
      droppedOperations: 0,
    },
    operations: [
      {
        type: "call",
        sequence: 0,
        ref: "pi.read",
        provider: "pi",
        action: "read",
        args: { path: "src/index.ts" },
        outcome: "succeeded",
        result: "export const value = 1;",
      },
      {
        type: "call",
        sequence: 1,
        ref: "pi.edit",
        provider: "pi",
        action: "edit",
        args: { path: "src/index.ts", oldText: "1", newText: "2" },
        outcome: "failed",
        error: "old text not found",
      },
    ],
  },
};

const fabricResult = (details: unknown) => ({
  role: "toolResult" as const,
  toolCallId: "outer",
  toolName: "fabric_exec",
  content: [{ type: "text" as const, text: "done" }],
  details,
  isError: false,
  timestamp: Date.now(),
});

describe("nested execution operations", () => {
  it("reads current durable execution traces", () => {
    const operations = executionOperationsOf(traceDetails);
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      ref: "pi.read",
      name: "read",
      args: { path: "src/index.ts" },
      outcome: "succeeded",
    });
    expect(executionResultText(operations[0]!)).toBe("export const value = 1;");
    expect(executionResultText(operations[1]!)).toBe("old text not found");
  });

  it("reads legacy audit details", () => {
    expect(executionOperationsOf({
      audits: [{
        ref: "pi.write",
        args: { path: "new.ts", content: "hello" },
        success: true,
        result: { output: "wrote file" },
      }],
    })).toEqual([{
      ref: "pi.write",
      name: "write",
      args: { path: "new.ts", content: "hello" },
      outcome: "succeeded",
      result: { output: "wrote file" },
    }]);
  });

  it("expands nested calls and results during compaction normalization", () => {
    expect(normalize([fabricResult(traceDetails) as any])).toEqual([
      {
        kind: "tool_result",
        name: "fabric_exec",
        text: "done",
        isError: false,
        sourceIndex: 0,
      },
      {
        kind: "tool_call",
        name: "read",
        args: { path: "src/index.ts" },
        sourceIndex: 0,
      },
      {
        kind: "tool_result",
        name: "read",
        text: "export const value = 1;",
        isError: false,
        sourceIndex: 0,
      },
      {
        kind: "tool_call",
        name: "edit",
        args: { path: "src/index.ts", oldText: "1", newText: "2" },
        sourceIndex: 0,
      },
      {
        kind: "tool_result",
        name: "edit",
        text: "old text not found",
        isError: true,
        sourceIndex: 0,
      },
    ]);
  });

  it("includes nested operations and files in recall rendering", () => {
    expect(renderMessage(fabricResult(traceDetails) as any, 4)).toMatchObject({
      index: 4,
      role: "tool_result",
      files: ["src/index.ts"],
    });
    expect(renderMessage(fabricResult(traceDetails) as any, 4).summary).toContain("read(path=src/index.ts)");
  });

  it("feeds nested file operations into summaries and recall search", () => {
    const message = fabricResult(traceDetails) as any;
    const summary = compile({
      messages: [
        { role: "user", content: [{ type: "text", text: "inspect the source" }] } as any,
        message,
      ],
    });
    expect(summary).toContain("Modified: src/index.ts");
    expect(summary).toContain("Read: src/index.ts");

    const rendered = [renderMessage(message, 0)];
    expect(searchEntries(rendered, [message], "old text not found")).toHaveLength(1);
    expect(searchEntries(rendered, [message], "src/index.ts")).toHaveLength(1);
  });

  it("ignores malformed traces atomically", () => {
    expect(executionOperationsOf({
      trace: {
        kind: "pi-fabric.execution",
        version: 1,
        operations: [{ ref: "pi.read", args: {}, outcome: "unknown" }],
      },
    })).toEqual([]);
  });
});
