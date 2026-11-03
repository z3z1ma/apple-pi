import type { Character, Headquarters, PlaceRef, WorldSnapshot } from "../../../src/world.js";
import { isOutside, placeKey } from "../../../src/world.js";
import { shortArg } from "../tool-line.js";

export type Attention = "asking" | "finished" | "working" | "idle";

export function attentionOf(character: Character): Attention {
	const facts = character.facts;
	if (!facts) return "idle";
	if (facts.status === "asking") return "asking";
	if (facts.status === "working") return "working";
	return facts.unseen ? "finished" : "idle";
}

export function unseenWhileWorking(character: Character): boolean {
	return attentionOf(character) === "working" && Boolean(character.facts?.unseen);
}

export interface Group {
	key: string;
	title: string;

	detail?: string;
	characters: Character[];
}

export function orbCounts(world: WorldSnapshot | undefined): { needsYou: number; working: number } {
	let needsYou = 0;
	let working = 0;
	for (const character of world?.characters ?? []) {
		const attention = attentionOf(character);
		if (attention === "asking" || attention === "finished") needsYou++;
		else if (attention === "working") working++;
	}
	return { needsYou, working };
}

const DEFAULT_LABELS: Record<string, string> = {
	headquarters: "Headquarters",
	"common-room": "Common room",
	"meeting-room": "Meeting room",
	gallery: "Gallery",
	wing: "wing",
	square: "Square",
};

const label = (labels: Record<string, string> | undefined, kind: string) =>
	labels?.[kind] ?? DEFAULT_LABELS[kind] ?? kind;

function headquartersOf(ref: PlaceRef, world: WorldSnapshot | undefined): Headquarters | undefined {
	return isOutside(ref) ? undefined : world?.headquarters.find((hq) => hq.id === ref.headquarters);
}

export function placeName(ref: PlaceRef, world: WorldSnapshot | undefined, labels?: Record<string, string>): string {
	if (ref.kind === "wing") {
		const wing = headquartersOf(ref, world)?.wings.find((w) => w.repository === ref.repository);
		return `${wing?.name ?? ref.repository.split("/").pop()} ${label(labels, "wing")}`;
	}
	return label(labels, ref.kind);
}

export function placeOwner(ref: PlaceRef, world: WorldSnapshot | undefined): string | undefined {
	if (isOutside(ref) || (world?.headquarters.length ?? 0) < 2) return undefined;
	const hq = headquartersOf(ref, world);
	return hq ? `${hq.name}'s` : undefined;
}

export const OUTSIDE: PlaceRef[] = [
	{ kind: "square" },
	{ kind: "street" },
	{ kind: "forge" },
	{ kind: "quest-office" },
	{ kind: "library" },
	{ kind: "inn" },
	{ kind: "rookery" },
];

export function placesOf(world: WorldSnapshot | undefined): PlaceRef[] {
	const places: PlaceRef[] = [];
	for (const hq of world?.headquarters ?? []) {
		places.push({ kind: "headquarters", headquarters: hq.id });
		places.push({ kind: "common-room", headquarters: hq.id });
		places.push({ kind: "gallery", headquarters: hq.id });
		places.push({ kind: "meeting-room", headquarters: hq.id });
		for (const wing of hq.wings) places.push({ kind: "wing", headquarters: hq.id, repository: wing.repository });
	}
	places.push(...OUTSIDE);
	return places;
}

export function byPlace(world: WorldSnapshot | undefined, labels?: Record<string, string>): Group[] {
	const characters = world?.characters ?? [];
	return placesOf(world).flatMap((ref) => {
		const key = placeKey(ref);
		const here = characters.filter((character) => placeKey(character.place) === key);
		if (!here.length) return [];
		return [{ key, title: placeName(ref, world, labels), detail: placeOwner(ref, world), characters: here }];
	});
}

export function needsYou(world: WorldSnapshot | undefined): Group[] {
	const waiting = (attention: Attention) =>
		(world?.characters ?? [])
			.filter((character) => attentionOf(character) === attention)
			.sort((a, b) => (a.facts?.needsYouSince ?? 0) - (b.facts?.needsYouSince ?? 0));
	const groups: Group[] = [
		{ key: "asking", title: "Questions", characters: waiting("asking") },
		{ key: "finished", title: "Finished, unseen", characters: waiting("finished") },
	];
	return groups.filter((group) => group.characters.length);
}

export function workLine(character: Character): string {
	return character.facts?.task?.title ?? "";
}

export function byTask(world: WorldSnapshot | undefined): Group[] {
	const tasks = new Map<string, Group>();
	const loose: Character[] = [];
	for (const character of world?.characters ?? []) {
		const task = character.facts?.task;
		if (!task) {
			loose.push(character);
			continue;
		}
		const group = tasks.get(task.bundle) ?? {
			key: task.bundle,
			title: task.title,
			detail: task.status ?? undefined,
			characters: [],
		};
		group.characters.push(character);
		tasks.set(task.bundle, group);
	}
	const groups = [...tasks.values()];
	if (loose.length) groups.push({ key: "no-task", title: "No focused task", characters: loose });
	return groups;
}

export function ago(since: number | null | undefined, now = Date.now()): string {
	if (!since) return "";
	const seconds = Math.max(0, Math.round((now - since) / 1000));
	if (seconds < 60) return "now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

export function activity(character: Character): string {
	const facts = character.facts;
	if (!facts) return "";
	const attention = attentionOf(character);
	if (attention === "asking") return facts.asking?.text ? `Asks: ${facts.asking.text}` : "Asks you something";
	if (facts.run === "running_tool" && facts.tool) {
		const arg = shortArg(facts.tool.arg, facts.cwd);
		return arg ? `${facts.tool.name} \u00b7 ${arg}` : facts.tool.name;
	}
	if (attention === "finished") return "Finished, unseen";
	if (attention === "working") {
		if (facts.run === "compacting") return "Compacting";
		if (facts.run === "writing_reply") return "Writing a reply";
		if (facts.run === "thinking") return "Thinking";
		return "Working";
	}
	return "Idle";
}
