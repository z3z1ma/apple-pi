// Which look a character wears: shared by the world's sprites and the conversation panel's portraits.
import type { Character } from "../src/world.js";
import type { Theme } from "./theme.js";

function hash(text: string): number {
	let h = 0;
	for (const char of text) h = (h * 31 + char.charCodeAt(0)) >>> 0;
	return h;
}

/** A coordinator wears the theme's coordinator look; everyone else one of its agent looks, fixed by session id. */
export function lookFor(theme: Theme, character: Pick<Character, "id" | "role">): string {
	const role = character.role === "coordinator" ? "coordinator" : "agent";
	const choices = Object.entries(theme.looks)
		.filter(([, look]) => look.role === role)
		.map(([name]) => name)
		.sort();
	return choices[hash(character.id) % choices.length];
}
