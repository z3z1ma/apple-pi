import type { Character, WorldSnapshot } from "../src/world.js";
import type { Theme } from "./theme.js";

function hash(text: string): number {
	let h = 0;
	for (const char of text) h = (h * 31 + char.charCodeAt(0)) >>> 0;
	return h;
}

export function lookFor(theme: Theme, character: Pick<Character, "id" | "role">): string {
	const role = character.role === "coordinator" ? "coordinator" : "agent";
	const choices = Object.entries(theme.looks)
		.filter(([, look]) => look.role === role)
		.map(([name]) => name)
		.sort();
	return choices[hash(character.id) % choices.length];
}

export const EXPRESSIONS = ["neutral", "happy", "thinking", "worried"] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export function portraitOf(theme: Theme, look: string, expression: Expression = "neutral"): string {
	return `${theme.url}characters/${look}-portrait-${EXPRESSIONS.indexOf(expression)}.png`;
}

export function expressionFor(character: Pick<Character, "facts">): Expression {
	const facts = character.facts;
	if (facts?.status === "asking") return "worried";
	if (facts?.status === "working") return "thinking";
	if (facts?.unseen) return "happy";
	return "neutral";
}

export function portraitFor(
	theme: Theme,
	character: Pick<Character, "id" | "role" | "facts">,
	expression: Expression = expressionFor(character),
): string {
	return portraitOf(theme, lookFor(theme, character), expression);
}

export interface AvatarLook {
	look: string;

	label: string;

	portrait: string;
}

export function avatarLooks(theme: Theme): AvatarLook[] {
	return Object.entries(theme.looks)
		.filter(([, look]) => look.role === "avatar")
		.map(([look]) => {
			const name = look.replace(/^avatar-/, "").replace(/-/g, " ");
			return { look, label: name.charAt(0).toUpperCase() + name.slice(1), portrait: portraitOf(theme, look) };
		});
}

export function avatarLookIn(theme: Theme, world: Pick<WorldSnapshot, "avatarLook"> | undefined): string {
	const looks = avatarLooks(theme);
	const chosen = world?.avatarLook;
	return looks.find(({ look }) => look === chosen)?.look ?? looks[0].look;
}
