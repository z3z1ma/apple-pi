import { DatabaseSync } from "node:sqlite";
import { isRetirePeopleRequest, type RetirePeopleProgress, type RetirePeopleRequest } from "../departures.js";
import type { Commands } from "./commands.js";

export function openDepartures(path: string, commands: Commands) {
	const running = new Map<string, { signature: string; result: Promise<RetirePeopleProgress> }>();
	const listeners = new Set<(progress: RetirePeopleProgress) => void>();
	let closed = false;
	const publish = (progress: RetirePeopleProgress) => {
		for (const listener of listeners) listener(structuredClone(progress));
	};
	async function execute(request: RetirePeopleRequest): Promise<RetirePeopleProgress> {
		const progress: RetirePeopleProgress = {
			id: request.id,
			people: request.people.map(({ person }) => ({ person, state: "pending" })),
			finished: false,
		};
		try {
			const db = new DatabaseSync(path, { readOnly: true });
			let parents: Map<string, string | null>;
			try {
				const rows = db.prepare("select id, reports_to from sessions where kind = 'root'").all() as {
					id: string;
					reports_to: string | null;
				}[];
				parents = new Map(rows.map((row) => [row.id, row.reports_to]));
			} finally {
				db.close();
			}
			const ancestors = (person: string) => {
				const result = new Set<string>();
				let parent = parents.get(person);
				while (parent) {
					if (parent === person || result.has(parent))
						throw new Error("Reporting contains a cycle; review the selection first.");
					result.add(parent);
					parent = parents.get(parent);
				}
				return result;
			};
			const ancestry = new Map(request.people.map(({ person }) => [person, ancestors(person)]));
			const order = [...progress.people].sort((a, b) => ancestry.get(b.person)!.size - ancestry.get(a.person)!.size);
			publish(progress);
			for (const outcome of order) {
				if (closed) {
					Object.assign(outcome, { state: "blocked", reason: "The app closed before this request was sent." });
					continue;
				}
				const blocked = order.find(
					(child) => ancestry.get(child.person)!.has(outcome.person) && child.state !== "applied",
				);
				if (blocked) {
					Object.assign(outcome, {
						state: "blocked",
						reason: `Selected report ${blocked.person} has not finished departure. No request sent for this manager.`,
					});
					publish(progress);
					continue;
				}
				const choice = request.people.find((person) => person.person === outcome.person)!;
				try {
					const result = await commands.send(
						outcome.person,
						{ kind: "retire", by: "operator", reason: request.reason, handoff: choice.handoff },
						{
							commandId: `retire-people:${encodeURIComponent(request.id)}:${encodeURIComponent(outcome.person)}`,
							onReceipt(state, reason) {
								Object.assign(outcome, { state, reason });
								publish(progress);
							},
						},
					);
					if (result.ok) Object.assign(outcome, { state: "applied", reason: undefined });
					else
						Object.assign(outcome, {
							state: outcome.state === "failed" ? "failed" : "uncertain",
							reason: result.reason,
						});
				} catch (error) {
					Object.assign(outcome, { state: "uncertain", reason: String(error) });
				}
				publish(progress);
			}
		} catch (error) {
			for (const outcome of progress.people)
				if (outcome.state === "pending") Object.assign(outcome, { state: "blocked", reason: String(error) });
		}
		progress.finished = true;
		publish(progress);
		return progress;
	}
	return {
		retirePeople(input: RetirePeopleRequest): Promise<RetirePeopleProgress> {
			if (!isRetirePeopleRequest(input))
				return Promise.reject(new Error("Choose distinct people, explicit handoff choices and a reason."));
			const request: RetirePeopleRequest = {
				id: input.id,
				reason: input.reason.trim(),
				people: input.people.map(({ person, handoff }) => ({ person, handoff })),
			};
			const signature = JSON.stringify([
				request.reason,
				[...request.people].sort((a, b) => a.person.localeCompare(b.person)),
			]);
			const previous = running.get(request.id);
			if (previous)
				return previous.signature === signature
					? previous.result
					: Promise.reject(new Error("This departure is already running with different choices."));
			const result = execute(request).finally(() => running.delete(request.id));
			running.set(request.id, { signature, result });
			return result;
		},
		onRetirePeople(listener: (progress: RetirePeopleProgress) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		close() {
			closed = true;
			listeners.clear();
		},
	};
}
