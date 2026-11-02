// RuneScape-style actions: whatever is under the pointer offers a list of actions; the first is what a left click
// does, and a right click lists them all. Later tickets add actions to targets (fidget objects, townsfolk, hubs).
import type { Character } from "../../src/world.js";
/** How the target's name is coloured: characters and objects read differently, as in RuneScape. */
export type Tone = "character" | "object";

export interface Action {
	/** The whole line the hover text and the menu show, such as "Talk to Orla". */
	label: string;
	/** The verb alone ("Talk to") and the target's name, for colouring; `label` is `verb target`. */
	verb: string;
	target?: string;
	tone?: Tone;
	run(): void;
}

export function action(verb: string, run: () => void, target?: string, tone?: Tone): Action {
	return { label: target ? `${verb} ${target}` : verb, verb, target, tone, run };
}

/** Something under the pointer that offers actions: a character, a door, later an object. */
export interface Target {
	name: string;
	tone: Tone;
	actions: Action[];
}

type TalkListener = (character: Character) => void;
const talkListeners = new Set<TalkListener>();

/**
 * Opening a conversation with a character. The world asks for it through a `talk-to` intent once the avatar has walked
 * up (the side panel asks without walking); the conversation panel (a later ticket) subscribes here.
 */
export const conversations = {
	open(character: Character) {
		for (const listener of talkListeners) listener(character);
	},
	subscribe(listener: TalkListener): () => void {
		talkListeners.add(listener);
		return () => talkListeners.delete(listener);
	},
};
