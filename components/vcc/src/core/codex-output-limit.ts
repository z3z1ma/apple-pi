export const CODEX_OUTPUT_LIMIT_COMPACT_INSTRUCTION = "__pi_vcc_codex_output_limit__";
export const CODEX_CONTEXT_OVERFLOW_COMPACT_INSTRUCTION = "__pi_vcc_codex_context_overflow__";

let codexContextOverflowPending = false;

const codexErrorMessage = (message: unknown): string | undefined => {
  if (!message || typeof message !== "object") return undefined;

  const candidate = message as {
    role?: unknown;
    provider?: unknown;
    api?: unknown;
    stopReason?: unknown;
    errorMessage?: unknown;
  };

  const isCodexMessage = candidate.provider === "openai-codex" || candidate.api === "openai-codex-responses";

  if (
    candidate.role !== "assistant" ||
    !isCodexMessage ||
    candidate.stopReason !== "error" ||
    typeof candidate.errorMessage !== "string"
  ) {
    return undefined;
  }

  return candidate.errorMessage;
};

/** Identify the Codex provider error used when a response reaches its output cap. */
export const isCodexOutputLimitError = (message: unknown): boolean => {
  const errorMessage = codexErrorMessage(message);
  return errorMessage !== undefined && /maximum output token limit/i.test(errorMessage);
};

/** Identify the Codex provider error used when the request input is too large. */
export const isCodexContextOverflowError = (message: unknown): boolean => {
  const errorMessage = codexErrorMessage(message);
  return errorMessage !== undefined && /exceeds the context window/i.test(errorMessage);
};

/** Mark a Codex context overflow until pi-core begins its recovery compaction. */
export const markCodexContextOverflowPending = (): void => {
  codexContextOverflowPending = true;
};

/** Check whether the pending Codex overflow belongs to the next compaction. */
export const isCodexContextOverflowPending = (): boolean => codexContextOverflowPending;

/** Clear pending Codex overflow state after compaction or session reset. */
export const clearCodexContextOverflowPending = (): void => {
  codexContextOverflowPending = false;
};
