type ExecutionOperationOutcome = "succeeded" | "failed" | "aborted" | "timed_out";

export interface ExecutionOperation {
  ref: string;
  name: string;
  args: Record<string, unknown>;
  outcome: ExecutionOperationOutcome;
  children?: ExecutionOperation[];
  error?: string;
  result?: unknown;
}

const OUTCOMES = new Set<ExecutionOperationOutcome>(["succeeded", "failed", "aborted", "timed_out"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nameOf = (ref: string, provider?: unknown, action?: unknown): string => {
  const separator = ref.indexOf(".");
  const lexicalProvider = separator > 0 ? ref.slice(0, separator) : undefined;
  const lexicalAction = separator > 0 && separator < ref.length - 1 ? ref.slice(separator + 1) : undefined;
  const resolvedProvider = typeof provider === "string" ? provider : lexicalProvider;
  const resolvedAction = typeof action === "string" ? action : lexicalAction;
  return resolvedProvider === "pi" && resolvedAction ? resolvedAction : (resolvedAction ?? ref);
};

const operationOf = (value: unknown): ExecutionOperation | undefined => {
  if (!isRecord(value) || typeof value.ref !== "string" || !isRecord(value.args)) return undefined;
  if (!OUTCOMES.has(value.outcome as ExecutionOperationOutcome)) return undefined;
  if (value.error !== undefined && typeof value.error !== "string") return undefined;
  let children: ExecutionOperation[] | undefined;
  if (value.children !== undefined) {
    if (!Array.isArray(value.children)) return undefined;
    children = [];
    for (const childValue of value.children) {
      const child = operationOf(childValue);
      if (!child) return undefined;
      children.push(child);
    }
  }
  return {
    ref: value.ref,
    name: nameOf(value.ref, value.provider, value.action),
    args: value.args,
    outcome: value.outcome as ExecutionOperationOutcome,
    ...(children && children.length > 0 ? { children } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(Object.hasOwn(value, "result") ? { result: value.result } : {}),
  };
};

const legacyOperationOf = (value: unknown): ExecutionOperation | undefined => {
  if (!isRecord(value) || typeof value.ref !== "string" || !isRecord(value.args)) return undefined;
  if (typeof value.success !== "boolean") return undefined;
  if (value.error !== undefined && typeof value.error !== "string") return undefined;
  return {
    ref: value.ref,
    name: nameOf(value.ref),
    args: value.args,
    outcome: value.success ? "succeeded" : "failed",
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(Object.hasOwn(value, "result") ? { result: value.result } : {}),
  };
};

/** Read nested operations from apple-pi or pi-fabric durable tool-result details. */
export const executionOperationsOf = (details: unknown): ExecutionOperation[] => {
  if (!isRecord(details)) return [];
  if (isRecord(details.trace)) {
    const trace = details.trace;
    const supported =
      (trace.kind === "apple-pi.execution" || trace.kind === "pi-fabric.execution") && trace.version === 1;
    if (!supported || !Array.isArray(trace.operations)) return [];
    const operations: ExecutionOperation[] = [];
    const append = (operation: ExecutionOperation): void => {
      operations.push(operation);
      for (const child of operation.children ?? []) append(child);
    };
    for (const value of trace.operations) {
      const operation = operationOf(value);
      if (!operation) return [];
      append(operation);
    }
    return operations;
  }
  if (!Array.isArray(details.audits)) return [];
  const operations: ExecutionOperation[] = [];
  for (const value of details.audits) {
    const operation = legacyOperationOf(value);
    if (!operation) return [];
    operations.push(operation);
  }
  return operations;
};

export const executionArgsText = (operation: ExecutionOperation): string => {
  try {
    return JSON.stringify(operation.args);
  } catch {
    return Object.keys(operation.args).join(" ");
  }
};

export const executionResultText = (operation: ExecutionOperation): string => {
  if (operation.error) return operation.error;
  const value = operation.result;
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    for (const key of ["output", "text", "content"]) {
      if (typeof value[key] === "string") return value[key] as string;
    }
  }
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
