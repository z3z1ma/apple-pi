import type { AgentSession } from "@earendil-works/pi-coding-agent";

/** Emit shutdown before disposal so child extensions release their session-scoped resources. */
export async function disposeAgentSession(session: AgentSession | undefined): Promise<void> {
	if (!session) return;
	try {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	} catch {
		// A broken extension must not prevent the session and its resources closing.
	}
	try {
		session.dispose();
	} catch {
		// Dispose is best-effort: this cleanup path must not leak a rejection.
	}
}
