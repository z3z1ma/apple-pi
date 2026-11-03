import type { Character } from "../../src/world.js";
export type Tone = "character" | "object";

export interface Action {
	label: string;
	verb: string;
	target?: string;
	tone?: Tone;
	run(): void;
}

export function action(verb: string, run: () => void, target?: string, tone?: Tone): Action {
	return { label: target ? `${verb} ${target}` : verb, verb, target, tone, run };
}

export interface Target {
	name: string;
	tone: Tone;
	actions: Action[];
}

type TalkListener = (character: Character) => void;
const talkListeners = new Set<TalkListener>();

export const conversations = {
	open(character: Character) {
		for (const listener of talkListeners) listener(character);
	},
	subscribe(listener: TalkListener): () => void {
		talkListeners.add(listener);
		return () => talkListeners.delete(listener);
	},
};
