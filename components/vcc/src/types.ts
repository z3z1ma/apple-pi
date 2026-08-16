import type { Message } from "@earendil-works/pi-ai";

export interface FileOps {
  readFiles?: string[];
  modifiedFiles?: string[];
  createdFiles?: string[];
}

/** Pre-computed look-ahead index: maps tool_call index → nearest tool_result block. */
export interface ToolResultIndex {
  get(callIndex: number): Extract<NormalizedBlock, { kind: "tool_result" }> | null;
}

export type NormalizedBlock =
  | { kind: "user"; text: string; sourceIndex?: number }
  | { kind: "assistant"; text: string; sourceIndex?: number }
  | { kind: "tool_call"; name: string; args: Record<string, unknown>; sourceIndex?: number }
  | { kind: "tool_result"; name: string; text: string; isError: boolean; sourceIndex?: number }
  | { kind: "bash"; command: string; output: string; exitCode: number | undefined; sourceIndex?: number }
  | { kind: "thinking"; text: string; redacted: boolean; sourceIndex?: number };
