import { fileURLToPath } from "node:url";
import { AgentSession, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const COMPACTION_SAFETY_EXTENSION_PATH = fileURLToPath(import.meta.url);

const AUTO_COMPACTION_FAILURE_GATE = Symbol.for("apple-pi.auto-compaction-failure-gate");
const AUTO_COMPACTION_FAILURE_STATE = Symbol.for("apple-pi.auto-compaction-failure-state");

type FailureState = { sessionIds: Set<string> };

function failureState(): FailureState {
	const host = globalThis as typeof globalThis & { [AUTO_COMPACTION_FAILURE_STATE]?: FailureState };
	if (!host[AUTO_COMPACTION_FAILURE_STATE]) host[AUTO_COMPACTION_FAILURE_STATE] = { sessionIds: new Set() };
	return host[AUTO_COMPACTION_FAILURE_STATE];
}

type AgentSessionInternals = {
	sessionManager: { getSessionId(): string };
	_runAutoCompaction(reason: string, willRetry: boolean): Promise<boolean>;
};

type AgentSessionPrototype = AgentSessionInternals & {
	[AUTO_COMPACTION_FAILURE_GATE]?: true;
};

function installAutomaticFailureGate(): void {
	const prototype = AgentSession.prototype as unknown as AgentSessionPrototype;
	if (prototype[AUTO_COMPACTION_FAILURE_GATE]) return;

	const descriptor = Object.getOwnPropertyDescriptor(prototype, "_runAutoCompaction");
	if (!descriptor || typeof descriptor.value !== "function") {
		throw new Error("Pi no longer exposes the expected automatic-compaction method");
	}
	const original = descriptor.value;
	const patched = async function (this: AgentSessionInternals, reason: string, willRetry: boolean): Promise<boolean> {
		const shouldContinue = await original.call(this, reason, willRetry);
		if (!failureState().sessionIds.delete(this.sessionManager.getSessionId())) return shouldContinue;

		const error = new Error("Automatic compaction failed or was cancelled");
		error.name = "AbortError";
		throw error;
	};

	Object.defineProperty(prototype, "_runAutoCompaction", { ...descriptor, value: patched });
	Object.defineProperty(prototype, AUTO_COMPACTION_FAILURE_GATE, { value: true });
}

/** Stop the active continuation when Pi cannot complete automatic compaction. */
export default function compactionSafety(pi: ExtensionAPI): void {
	installAutomaticFailureGate();
	pi.on("session_compact_failed", (event, ctx) => {
		if (event.reason === "manual") return;
		failureState().sessionIds.add(ctx.sessionManager.getSessionId());
		ctx.abort();
	});
}
