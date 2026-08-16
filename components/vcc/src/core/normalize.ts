import type { Message } from "@earendil-works/pi-ai";
import type { NormalizedBlock } from "../types";
import { textOf } from "./content";
import { sanitize } from "./sanitize";
import { executionOperationsOf, executionResultText } from "./execution-trace";

const normalizeOne = (msg: Message, msgIndex: number): NormalizedBlock[] => {
  if (msg.role === "user") {
    const blocks: NormalizedBlock[] = [];
    const text = sanitize(textOf(msg.content));
    if (text) blocks.push({ kind: "user", text, sourceIndex: msgIndex });
    if (msg.content && typeof msg.content !== "string") {
      for (const part of msg.content) {
        if (part.type === "image") {
          blocks.push({ kind: "user", text: `[image: ${part.mimeType}]`, sourceIndex: msgIndex });
        }
      }
    }
    return blocks.length > 0 ? blocks : [{ kind: "user", text: "", sourceIndex: msgIndex }];
  }

  if ((msg as any).role === "bashExecution") {
    const cmd = (msg as any).command ?? "";
    const out = (msg as any).output ?? "";
    const exit = (msg as any).exitCode;
    return [{ kind: "bash", command: cmd, output: out, exitCode: exit, sourceIndex: msgIndex }];
  }

  if (msg.role === "toolResult") {
    const blocks: NormalizedBlock[] = [
      {
        kind: "tool_result",
        name: msg.toolName,
        text: sanitize(textOf(msg.content)),
        isError: msg.isError,
        sourceIndex: msgIndex,
      },
    ];
    if (msg.toolName === "fabric_exec" || msg.toolName === "pi_exec") {
      for (const operation of executionOperationsOf((msg as any).details)) {
        blocks.push({
          kind: "tool_call",
          name: operation.name,
          args: operation.args,
          sourceIndex: msgIndex,
        });
        blocks.push({
          kind: "tool_result",
          name: operation.name,
          text: sanitize(executionResultText(operation)),
          isError: operation.outcome !== "succeeded",
          sourceIndex: msgIndex,
        });
      }
    }
    return blocks;
  }

  if (msg.role === "assistant") {
    if (!msg.content) return [];
    if (typeof msg.content === "string") {
      return [{ kind: "assistant", text: sanitize(msg.content), sourceIndex: msgIndex }];
    }

    const blocks: NormalizedBlock[] = [];
    for (const part of msg.content) {
      if (part.type === "text") {
        blocks.push({ kind: "assistant", text: sanitize(part.text), sourceIndex: msgIndex });
      } else if (part.type === "thinking") {
        blocks.push({
          kind: "thinking",
          text: sanitize(part.thinking),
          redacted: part.redacted ?? false,
          sourceIndex: msgIndex,
        });
      } else if (part.type === "toolCall") {
        blocks.push({
          kind: "tool_call",
          name: part.name,
          args: part.arguments,
          sourceIndex: msgIndex,
        });
      }
    }
    return blocks;
  }

  return [];
};

export const normalize = (messages: Message[]): NormalizedBlock[] => messages.flatMap((msg, i) => normalizeOne(msg, i));
