/**
 * The `pi.events` channel on which the ledger extension announces each time a session touches a task: creating it,
 * changing its status, or changing its files. Unlike `history.json`, which records a session once per task, every
 * touch is announced, so a listener (the session-state bridge) sees which task a session works on over time.
 */
export const LEDGER_LINK_CHANNEL = "ledger:session-linked";

export interface LedgerLink {
	sessionId: string;
	/** Absolute path of the task bundle, live or archived. */
	bundle: string;
	taskId: string;
	via: "ledger_add" | "ledger_status" | "edit";
}
