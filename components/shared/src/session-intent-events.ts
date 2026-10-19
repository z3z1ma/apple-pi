/**
 * The `pi.events` channel on which the session-title extension announces a session's stated intent: one short
 * sentence of what it works on now, written after a settled user turn. The session-state bridge reports it as the
 * session's `intent` fact; views show it when the session has no ledger task.
 */
export const SESSION_INTENT_CHANNEL = "session-title:intent";

export interface SessionIntent {
	sessionId: string;
	intent: string;
}
