import type { AgentSession } from "@earendil-works/pi-coding-agent";

const INPUT = Symbol.for("apple-pi.session-input");
const SEAL = Symbol.for("apple-pi.launch-input-seal");
const CLOSING =
	"This session is sealed for automatic departure. Retry after reopening or incorporating the organization.";

export interface SessionInput {
	readonly ticket: string | undefined;
	seal(ticket: string): boolean;
	release(ticket: string): void;
}

export function sessionInput(session: AgentSession): SessionInput {
	const retained = (session as AgentSession & Record<symbol, SessionInput | undefined>)[INPUT];
	if (retained) return retained;
	let pending = 0;
	const launch = process as NodeJS.Process & Record<symbol, { ticket?: string } | undefined>;
	const state = launch[SEAL] ?? {};
	launch[SEAL] = state;
	const run = async <T>(operation: () => Promise<T>): Promise<T> => {
		if (state.ticket) throw new Error(CLOSING);
		pending++;
		try {
			return await operation();
		} finally {
			pending--;
		}
	};
	const prompt = session.prompt;
	const steer = session.steer;
	const followUp = session.followUp;
	const sendCustomMessage = session.sendCustomMessage;
	const executeBash = session.executeBash;
	session.prompt = (...args) => run(() => prompt.apply(session, args));
	session.steer = (...args) => run(() => steer.apply(session, args));
	session.followUp = (...args) => run(() => followUp.apply(session, args));
	session.sendCustomMessage = (message, options) =>
		options?.triggerTurn === true
			? run(() => sendCustomMessage.call(session, message, options))
			: sendCustomMessage.call(session, message, options);
	session.executeBash = (...args) => run(() => executeBash.apply(session, args));
	const gate: SessionInput = {
		get ticket() {
			return state.ticket;
		},
		seal(next) {
			if (pending || !session.isIdle || session.pendingMessageCount || session.isBashRunning) return false;
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
