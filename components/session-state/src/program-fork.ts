import { statSync } from "node:fs";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

type SessionReader = ExtensionContext["sessionManager"];
export const PROGRAM_FORK_ENTRY = "program-fork";
export interface ProgramFork {
	session: string;
	cost: number;
	offset: number;
}

export function forkBoundary(session: SessionReader): ProgramFork | undefined {
	const id = session.getSessionId();
	for (const entry of session.getEntries()) {
		if (isBoundary(entry, id)) return (entry as { data: ProgramFork }).data;
	}
	return undefined;
}

export function recordProgramFork(session: SessionReader, append: (data: ProgramFork) => void): void {
	const file = session.getSessionFile();
	if (!file || !session.getHeader()?.parentSession || forkBoundary(session)) return;
	append({ session: session.getSessionId(), cost: sessionCost(session), offset: statSync(file).size });
}

export function sessionCost(session: Pick<SessionReader, "getEntries" | "getSessionId">): number {
	let total = 0;
	for (const entry of session.getEntries()) {
		if (isBoundary(entry, session.getSessionId())) total = 0;
		else if (entry.type === "message" && entry.message.role === "assistant")
			total += entry.message.usage?.cost?.total ?? 0;
	}
	return total;
}

function isBoundary(entry: SessionEntry, id: string): boolean {
	return (
		entry.type === "custom" &&
		entry.customType === PROGRAM_FORK_ENTRY &&
		(entry.data as ProgramFork | undefined)?.session === id
	);
}
