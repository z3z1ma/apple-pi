import type { AgentSession } from "@earendil-works/pi-coding-agent";

const INPUT = Symbol.for("apple-pi.session-input");
const SEAL = Symbol.for("apple-pi.launch-input-seal");
const CLOSING =
	"This session is sealed for automatic departure. Retry after reopening or incorporating the organization.";

export interface SessionInput {
	readonly scope: "launch" | undefined;
	readonly ticket: string | undefined;
	seal(ticket: string): boolean;
	release(ticket: string): void;
}

export function sessionInput(session: AgentSession): SessionInput {
	const retained = (session as AgentSession & Record<symbol, SessionInput | undefined>)[INPUT];
	if (retained) return retained;
	const launch = process as NodeJS.Process & Record<symbol, { ticket?: string; pending?: number } | undefined>;
	const state = launch[SEAL] ?? { pending: 0 };
	launch[SEAL] = state;
	const run = async <T>(operation: () => Promise<T>): Promise<T> => {
		if (state.ticket) throw new Error(CLOSING);
		if (state.pending !== undefined) state.pending++;
		try {
			return await operation();
		} finally {
			if (state.pending !== undefined) state.pending--;
		}
	};
	const prompt = session.prompt;
	const steer = session.steer;
	const followUp = session.followUp;
	const sendCustomMessage = session.sendCustomMessage;
	const executeBash = session.executeBash;
	const navigateTree = session.navigateTree;
	const compact = session.compact;
	const reload = session.reload;
	const summarizeForBugReport = session.summarizeForBugReport;
	session.prompt = (...args) => run(() => prompt.apply(session, args));
	session.steer = (...args) => run(() => steer.apply(session, args));
	session.followUp = (...args) => run(() => followUp.apply(session, args));
	session.sendCustomMessage = (message, options) =>
		options?.triggerTurn === true
			? run(() => sendCustomMessage.call(session, message, options))
			: sendCustomMessage.call(session, message, options);
	session.executeBash = (...args) => run(() => executeBash.apply(session, args));
	session.navigateTree = (...args) => run(() => navigateTree.apply(session, args));
	session.compact = (...args) => run(() => compact.apply(session, args));
	session.reload = (...args) => run(() => reload.apply(session, args));
	session.summarizeForBugReport = (...args) => run(() => summarizeForBugReport.apply(session, args));
	const gate: SessionInput = {
		scope: state.pending === undefined ? undefined : "launch",
		get ticket() {
			return state.ticket;
		},
		seal(next) {
			if (state.ticket && state.ticket !== next) return false;
			if (state.pending !== 0 || !session.isIdle || session.pendingMessageCount || session.isBashRunning) return false;
			state.ticket = next;
			return true;
		},
		release(expected) {
			if (state.ticket === expected) state.ticket = undefined;
		},
	};
	Object.defineProperty(session, INPUT, { value: gate });
	return gate;
}
