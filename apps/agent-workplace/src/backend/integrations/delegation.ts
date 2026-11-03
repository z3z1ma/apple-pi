import type { Delegation, DelegationItem, Outcome } from "../../integrations.js";
import type { Character, ReceiptStage, WorldSnapshot } from "../../world.js";
import type { Commands } from "../commands.js";
import { instruct } from "../instructions.js";

const NOTE_MAX = 4000;

export function delegationTarget(snapshot: WorldSnapshot, to: string, near?: string): Character | undefined {
	const awake = (id: string | null | undefined) => (id ? snapshot.characters.find((c) => c.id === id) : undefined);
	if (to !== "coordinator") return awake(to);
	const reportsTo = near ? awake(near)?.facts?.reportsTo : undefined;
	const theirs = awake(reportsTo);
	if (theirs?.role === "coordinator") return theirs;
	for (const headquarters of snapshot.headquarters) {
		const coordinator = awake(headquarters.id);
		if (coordinator) return coordinator;
	}
	return snapshot.characters.find((c) => c.role === "coordinator");
}

const quoted = (text: string) => `"${text.replace(/\s+/g, " ").trim()}"`;

function itemName(item: DelegationItem): string {
	switch (item.kind) {
		case "pull-request":
			return `pull request ${item.repo}#${item.number} ${quoted(item.title)}: ${item.url}`;
		case "issue":
			return `issue ${item.key} ${quoted(item.summary)}: ${item.url}`;
		case "page":
			return `the Confluence page ${quoted(item.title)}: ${item.url}`;
		case "thread":
			return `this Slack thread in #${item.channelName}${item.preview ? ` (${quoted(item.preview)})` : ""}: ${item.url ?? `channel ${item.channel}, thread ${item.ts}`}`;
	}
}

export function delegationText(delegation: Delegation): string {
	const { item, ask } = delegation;
	const name = itemName(item);
	const asked = {
		"address-review": `Please address the review on ${name}`,
		"get-reviewed": `Please get ${name} reviewed`,
		"start-work": `Please start work on ${name}`,
		summarise: `Please read ${name}\nSummarise it for me here.`,
		update: `Please update ${name}`,
		"look-into": `Please look into ${name}`,
	}[ask];
	const privately = item.kind === "thread" ? "\nReport back to me here; do not post in Slack." : "";
	const note = delegation.note?.trim() ? `\n\n${delegation.note.trim().slice(0, NOTE_MAX)}` : "";
	return `${asked}${privately}${note}`;
}

const ASKS = new Set(["address-review", "get-reviewed", "start-work", "summarise", "update", "look-into"]);
const text = (value: unknown) => typeof value === "string" && value.length > 0 && value.length < 2000;

export function checkDelegation(given: unknown): Delegation | undefined {
	const value = (given ?? {}) as Partial<Delegation> & { item?: Record<string, unknown> };
	if (!text(value.to) || !ASKS.has(String(value.ask)) || !value.item) return undefined;
	if (value.near !== undefined && !text(value.near)) return undefined;
	if (value.note !== undefined && typeof value.note !== "string") return undefined;
	const item = value.item;
	const fits =
		(item.kind === "pull-request" &&
			text(item.repo) &&
			Number.isSafeInteger(item.number) &&
			typeof item.title === "string" &&
			text(item.url)) ||
		(item.kind === "issue" && text(item.key) && typeof item.summary === "string" && text(item.url)) ||
		(item.kind === "page" && text(item.id) && typeof item.title === "string" && text(item.url)) ||
		(item.kind === "thread" &&
			text(item.channel) &&
			typeof item.channelName === "string" &&
			text(item.ts) &&
			(item.url === null || text(item.url)) &&
			(item.preview === undefined || typeof item.preview === "string"));
	return fits ? (value as Delegation) : undefined;
}

export async function delegate(
	commands: Commands,
	snapshot: WorldSnapshot,
	commandId: string,
	given: unknown,
	onReceipt: (characterId: string, stage: ReceiptStage, reason?: string) => void,
): Promise<Outcome<{ to: string; command: "talk" | "follow_up" }>> {
	const delegation = checkDelegation(given);
	if (!delegation) return { ok: false, reason: "That request does not name what to work on." };
	const target = delegationTarget(snapshot, delegation.to, delegation.near);
	if (!target)
		return {
			ok: false,
			reason: delegation.to === "coordinator" ? "No coordinator is awake." : "That agent is not awake.",
		};
	const command = (target.facts?.run ?? "idle") === "idle" ? "talk" : "follow_up";
	const result = await instruct(
		commands,
		target,
		commandId,
		{ kind: command, text: delegationText(delegation) },
		(stage, reason) => onReceipt(target.id, stage, reason),
	);
	return result.ok ? { ok: true, to: target.id, command } : result;
}
