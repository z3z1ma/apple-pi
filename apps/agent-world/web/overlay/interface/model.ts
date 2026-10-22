// What the interface derives from the world snapshot: each character's attention, the groupings of each tab, the orb
// counts, and the names of places. Pure, so the views only draw. Attention matches the tmux sidebar: asking means an
// open prompt; working is any run but idle; finished means idle with a settle not seen yet. What it does now comes
// first: a character that works again after an unseen settle is working, with the unseen result marked beside it.
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

/** Working, with the result of an earlier run still unseen. */
export function unseenWhileWorking(character: Character): boolean {
	return attentionOf(character) === "working" && Boolean(character.facts?.unseen);
}

export interface Group {
	/** Stable key, for React and for tests. */
	key: string;
	title: string;
	/** A quieter second part of the heading, such as a task's status or whose headquarters. */
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

/** Labels the interface falls back to before the theme has loaded. */
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

/** A place's name, such as "Guild hall" or "apple-pi wing". */
export function placeName(ref: PlaceRef, world: WorldSnapshot | undefined, labels?: Record<string, string>): string {
	if (ref.kind === "wing") {
		const wing = headquartersOf(ref, world)?.wings.find((w) => w.repository === ref.repository);
		return `${wing?.name ?? ref.repository.split("/").pop()} ${label(labels, "wing")}`;
	}
	return label(labels, ref.kind);
}

/** Whose headquarters a place belongs to, when there is more than one to tell apart. */
export function placeOwner(ref: PlaceRef, world: WorldSnapshot | undefined): string | undefined {
	if (isOutside(ref) || (world?.headquarters.length ?? 0) < 2) return undefined;
	const hq = headquartersOf(ref, world);
	return hq ? `${hq.name}'s` : undefined;
}

/** The places outside any headquarters, in the order the Places tab lists them. */
export const OUTSIDE: PlaceRef[] = [
	{ kind: "square" },
	{ kind: "street" },
	{ kind: "forge" },
	{ kind: "quest-office" },
	{ kind: "library" },
	{ kind: "inn" },
	{ kind: "rookery" },
];

/** Every place that exists now, in the order the world opens them: each headquarters' rooms and wings, then the square. */
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

/** The Agents tab: everyone grouped by where they are, places in world order, people by session start. */
export function byPlace(world: WorldSnapshot | undefined, labels?: Record<string, string>): Group[] {
	const characters = world?.characters ?? [];
	return placesOf(world).flatMap((ref) => {
		const key = placeKey(ref);
		const here = characters.filter((character) => placeKey(character.place) === key);
		if (!here.length) return [];
		return [{ key, title: placeName(ref, world, labels), detail: placeOwner(ref, world), characters: here }];
	});
}

/** The Needs you tab: questions first, then finished work, each the longest-waiting first. */
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

/** The explicit focused task, or no work line when the person has not focused an assignment. */
export function workLine(character: Character): string {
	return character.facts?.task?.title ?? "";
}

/** The Work tab: people grouped by focused task; those without a focus last. */
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

/** "3m", "2h", "4d": how long ago, roughly. */
export function ago(since: number | null | undefined, now = Date.now()): string {
	if (!since) return "";
	const seconds = Math.max(0, Math.round((now - since) / 1000));
	if (seconds < 60) return "now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/** One line on what a character is doing now, from observed facts only. */
export function activity(character: Character): string {
	const facts = character.facts;
	if (!facts) return "";
	const attention = attentionOf(character);
	if (attention === "asking") return facts.asking?.text ? `Asks: ${facts.asking.text}` : "Asks you something";
	if (facts.tool) {
		const arg = shortArg(facts.tool.arg, facts.cwd);
		return arg ? `${facts.tool.name} \u00b7 ${arg}` : facts.tool.name;
	}
	if (attention === "finished") return "Finished, unseen";
	if (attention === "working") return facts.run === "compacting" ? "Compacting" : "Working";
	return "Idle";
}
