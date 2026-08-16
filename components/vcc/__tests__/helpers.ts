/**
 * Helpers for constructing mock session entries and messages.
 *
 * These mirror pi-agent-core types but use loose object shapes
 * so we don't need the actual runtime dependency in tests.
 */

export interface MockEntry {
  type: string;
  id?: string;
  message?: {
    role?: string;
    content?: unknown;
    stopReason?: string;
  };
  firstKeptEntryId?: string;
  summary?: string;
  timestamp?: string;
}

let nextId = 1;

function makeId(): string {
  return `entry_${nextId++}`;
}

export function resetIds(): void {
  nextId = 1;
}

export function makeUserEntry(
  text: string,
  overrides?: Partial<MockEntry>,
): MockEntry {
  const id = makeId();
  return {
    type: "message",
    id,
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
    ...overrides,
  };
}

export function makeAssistantEntry(
  text: string,
  stopReason = "stop",
  overrides?: Partial<MockEntry>,
): MockEntry {
  const id = makeId();
  return {
    type: "message",
    id,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      stopReason,
    },
    ...overrides,
  };
}

export function makeToolResultEntry(
  toolCallId: string,
  content: string,
  overrides?: Partial<MockEntry>,
): MockEntry {
  const id = makeId();
  return {
    type: "message",
    id,
    message: {
      role: "toolResult",
      content: [{ type: "toolResult", toolCallId, content }],
    },
    ...overrides,
  };
}

export function makeCompactionEntry(
  firstKeptEntryId: string,
  overrides?: Partial<MockEntry>,
): MockEntry {
  const id = makeId();
  return {
    type: "compaction",
    id,
    firstKeptEntryId,
    summary: "Compaction summary",
    ...overrides,
  };
}

/**
 * Build a context snapshot dict matching Agent.state.messages shape.
 * Used for testing the "continue from assistant message" scenarios.
 */
export interface ContextMessage {
  role: string;
  content: unknown;
  stopReason?: string;
}

export function makeContextMessages(
  ...msgs: ContextMessage[]
): ContextMessage[] {
  return msgs;
}

export function userMsg(text: string): ContextMessage {
  return { role: "user", content: [{ type: "text", text }] };
}

export function assistantMsg(
  text: string,
  stopReason = "stop",
): ContextMessage {
  return { role: "assistant", content: [{ type: "text", text }], stopReason };
}

export function toolResultMsg(
  toolCallId: string,
  content: string,
): ContextMessage {
  return {
    role: "toolResult",
    content: [{ type: "toolResult", toolCallId, content }],
  };
}

export function compactionSummaryMsg(summary: string): ContextMessage {
  return { role: "user", content: [{ type: "compactionSummary", text: summary }] };
}
