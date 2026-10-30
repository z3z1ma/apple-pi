import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
	type CommunicationInput,
	type CommunicationOperation,
	communicationAttempt,
	communicationAttemptId,
	findChannels,
	readConversation,
	requireCommunication,
	searchMessages,
} from "../../../../components/session-state/src/communication.js";
import { OPERATOR } from "../../../../components/session-state/src/threads.js";
import type { CommunicationQuery, CommunicationResult, CommunicationsApi } from "../communications.js";
import type { Commands } from "./commands.js";

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
	return value;
}

function people(value: unknown): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || !value.every((person) => typeof person === "string" && person.trim()))
		throw new Error("Recipients must be a list of person IDs.");
	return value;
}

/** Read-only views and operator commands over the runtime's existing communication journal. */
export function openCommunications(path: string, commands: Commands): CommunicationsApi {
	function read<T>(query: (db: DatabaseSync) => T): T {
		const db = new DatabaseSync(path, { readOnly: true });
		try {
			db.exec("pragma query_only = 1");
			requireCommunication(db);
			return query(db);
		} finally {
			db.close();
		}
	}
	function query<T>(run: (db: DatabaseSync) => T): CommunicationQuery<T> {
		try {
			return { ok: true, value: read(run) };
		} catch (error) {
			return { ok: false, reason: reasonOf(error) };
		}
	}
	async function mutate(
		request: { attempt: string },
		tool: string,
		operation: () => CommunicationOperation,
	): Promise<CommunicationResult> {
		let attempt = "";
		let submitted = false;
		try {
			attempt = communicationAttemptId(OPERATOR, text(request?.attempt, "An attempt ID"));
			const { attempt: _invocation, ...arguments_ } = request;
			const input: CommunicationInput = { tool: `workplace.${tool}`, arguments: arguments_ };
			const recorded = read((db) => communicationAttempt(db, OPERATOR, attempt, input));
			if (recorded.outcome === "applied" || recorded.outcome === "refused") return recorded;
			const command = recorded.command ?? {
				kind: "communication" as const,
				version: 1 as const,
				input,
				operation: operation(),
			};
			submitted = true;
			const receipt = await commands.send(OPERATOR, command, { commandId: attempt });
			const result = read((db) => communicationAttempt(db, OPERATOR, attempt, input));
			if (result.outcome === "not_recorded")
				return {
					attempt,
					outcome: "uncertain",
					reason: receipt.ok
						? "The runtime answered, but no communication record is available. Check this attempt before sending again."
						: receipt.reason,
				};
			return !receipt.ok && result.outcome === "pending" ? { ...result, reason: receipt.reason } : result;
		} catch (error) {
			return { attempt, outcome: submitted ? "uncertain" : "refused", reason: reasonOf(error) };
		}
	}
	return {
		sendMail(request) {
			return mutate(request, "sendMail", () => ({
				action: "post",
				thread: `t-${randomUUID()}`,
				threadKind: "mail",
				to: people(request.to),
				cc: people(request.cc),
				subject: text(request.subject, "A subject"),
				body: text(request.body, "A message"),
			}));
		},
		async findChannels(options) {
			return query((db) => findChannels(db, OPERATOR, options));
		},
		async searchMessages(options) {
			return query((db) => searchMessages(db, OPERATOR, options));
		},
		createChannel(request) {
			return mutate(request, "createChannel", () => ({
				action: "create_channel",
				scopeHead: text(request.scopeHead, "An organization scope"),
				name: text(request.name, "A channel name"),
				purpose: text(request.purpose, "A channel purpose"),
				invite: people(request.invite),
			}));
		},
		async readThread(request) {
			if (request?.view !== undefined && !["catch_up", "recent", "range"].includes(request.view))
				return { ok: false, reason: "Choose catch_up, recent or range." };
			if (request?.view === "recent" || request?.view === "range") {
				const result = query((db) =>
					readConversation(db, OPERATOR, {
						thread: request.thread,
						view: request.view,
						limit: request.limit,
						after: request.after,
						through: request.through,
						cursor: request.cursor,
					}),
				);
				return result.ok ? { ok: true, page: result.value } : result;
			}
			const result = await mutate({ ...request, attempt: request?.attempt ?? "" }, "readThread", () => ({
				action: "read",
				thread: text(request.thread, "A conversation"),
				view: "catch_up",
				limit: request.limit,
				after: request.after,
				through: request.through,
				cursor: request.cursor,
			}));
			if ("effect" in result && result.effect?.page)
				return { ok: true, page: result.effect.page, attempt: result.attempt };
			return {
				ok: false,
				reason: result.reason ?? "Catch-up is not confirmed. Check the recorded attempt before retrying.",
				attempt: result.attempt,
			};
		},
		post(request) {
			return mutate(request, "post", () => ({
				action: "post",
				thread: text(request.thread, "A conversation"),
				body: text(request.body, "A message"),
				notify: people(request.notify),
			}));
		},
		join(request) {
			return mutate(request, "join", () => ({ action: "join", thread: text(request.thread, "A channel") }));
		},
		leave(request) {
			return mutate(request, "leave", () => ({ action: "leave", thread: text(request.thread, "A conversation") }));
		},
		invite(request) {
			return mutate(request, "invite", () => ({
				action: "invite",
				thread: text(request.thread, "A conversation"),
				people: people(request.people),
			}));
		},
		removeInvitations(request) {
			return mutate(request, "removeInvitations", () => ({
				action: "remove",
				thread: text(request.thread, "A conversation"),
				people: people(request.people),
			}));
		},
		pin(request) {
			return mutate(request, "pin", () => {
				if (!Number.isSafeInteger(request.seq) || request.seq < 1) throw new Error("A message sequence is required.");
				return { action: "pin", thread: text(request.thread, "A conversation"), seq: request.seq };
			});
		},
		archive(request) {
			return mutate(request, "archive", () => ({
				action: "archive",
				thread: text(request.thread, "A conversation"),
				body: text(request.summary, "A conclusion"),
				notify: people(request.notify),
			}));
		},
		reopen(request) {
			return mutate(request, "reopen", () => ({
				action: "reopen",
				thread: text(request.thread, "A conversation"),
				body: text(request.reason, "A reopening reason"),
				notify: people(request.notify),
			}));
		},
		async status(request) {
			let attempt = "";
			try {
				attempt = text(request?.attempt, "An attempt ID");
				return read((db) => {
					const direct = communicationAttempt(db, OPERATOR, attempt);
					if (direct.outcome !== "not_recorded") return direct;
					const derived = communicationAttempt(db, OPERATOR, communicationAttemptId(OPERATOR, attempt));
					return derived.outcome !== "not_recorded" ? derived : direct;
				});
			} catch (error) {
				return { attempt, outcome: "uncertain", reason: reasonOf(error) };
			}
		},
	};
}
