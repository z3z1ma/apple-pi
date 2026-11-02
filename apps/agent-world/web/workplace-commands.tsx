import type { WorldSnapshot } from "../src/world.js";
import { conversationPanel } from "./overlay/conversation/panel-state.js";
import { deliver } from "./workplace-message-actions.js";

/** Slash commands a channel composer runs itself instead of posting. */
export const COMMANDS = [
	{ name: "dm", usage: "/dm @person message", help: "Tell one person something without leaving here" },
	{ name: "wake", usage: "/wake @person", help: "Bring a person at home back" },
	{ name: "stop", usage: "/stop @person", help: "Stop what a working person is doing" },
] as const;

type Person = { id: string; name: string };

function everyone(world: WorldSnapshot): Person[] {
	return [
		...world.characters.map((person) => ({ id: person.id, name: person.name })),
		...(world.dormant ?? [])
			.filter((person) => !person.retiredAt)
			.map((person) => ({ id: person.id, name: person.name })),
	];
}

/** The person named first in `rest` (with or without @), by the longest matching name, and the words after it. */
function named(world: WorldSnapshot, rest: string): { person: Person; words: string } | undefined {
	const text = rest.replace(/^@/, "");
	const match = everyone(world)
		.filter((person) => text.toLowerCase().startsWith(person.name.toLowerCase()))
		.sort((a, b) => b.name.length - a.name.length)[0];
	return match ? { person: match, words: text.slice(match.name.length).trim() } : undefined;
}

/** Commands whose name starts with what was typed after the slash, while no space follows it yet. */
export function commandHints(draft: string) {
	const typed = /^\/(\w*)$/.exec(draft)?.[1];
	return typed === undefined ? [] : COMMANDS.filter((command) => command.name.startsWith(typed.toLowerCase()));
}

/** Run a slash command; undefined when the text is not one, otherwise what happened, for the composer's status line. */
export async function runCommand(
	world: WorldSnapshot,
	draft: string,
): Promise<{ ok: boolean; note: string } | undefined> {
	const match = /^\/(\w+)\s*([\s\S]*)$/.exec(draft.trim());
	if (!match) return undefined;
	const command = COMMANDS.find((item) => item.name === match[1]!.toLowerCase());
	if (!command) return undefined;
	const target = named(world, match[2]!);
	if (!target) return { ok: false, note: `Name someone after /${command.name}: ${command.usage}` };
	const { person, words } = target;
	const api = window.agentWorld;
	if (command.name === "dm") {
		if (!words) return { ok: false, note: `Write the message after the name: ${command.usage}` };
		const result = await deliver(world, { kind: "dm", id: person.id }, words);
		return result.ok
			? { ok: true, note: `Sent to ${person.name}.` }
			: { ok: false, note: `Not sent to ${person.name}: ${result.reason}` };
	}
	if (command.name === "wake") {
		const receipt = await api.wake(person.id);
		return receipt.ok
			? { ok: true, note: `${person.name} is coming back.` }
			: { ok: false, note: `${person.name} did not wake: ${receipt.reason}` };
	}
	const awake = world.characters.find((item) => item.id === person.id);
	if (!awake) return { ok: false, note: `${person.name} is away; nothing to stop.` };
	const ok = await conversationPanel.instruct(awake, { kind: "abort", confirmed: true });
	return ok ? { ok: true, note: `Stopped ${person.name}.` } : { ok: false, note: `${person.name} did not stop.` };
}
