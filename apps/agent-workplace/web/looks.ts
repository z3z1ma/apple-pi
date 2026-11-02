// Which look a character wears, and its portraits: shared by the world's sprites, Settings, and the conversation
// panel. A look is one character sheet of the theme (`characters/<look>.png`) with four portraits beside it.
import type { Character, WorldSnapshot } from "../src/world.js";
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

/** The four painted expressions every look has, in the order of their files (`<look>-portrait-0..3.png`). */
export const EXPRESSIONS = ["neutral", "happy", "thinking", "worried"] as const;
export type Expression = (typeof EXPRESSIONS)[number];

/** The URL of a look's portrait in one expression. */
export function portraitOf(theme: Theme, look: string, expression: Expression = "neutral"): string {
	return `${theme.url}characters/${look}-portrait-${EXPRESSIONS.indexOf(expression)}.png`;
}

/**
 * The expression a character's state calls for (decision 22): asking you, worried; at work, thinking; finished and
 * not seen yet, happy; otherwise neutral.
 */
export function expressionFor(character: Pick<Character, "facts">): Expression {
	const facts = character.facts;
	if (facts?.status === "asking") return "worried";
	if (facts?.status === "working") return "thinking";
	if (facts?.unseen) return "happy";
	return "neutral";
}

/** A character's portrait: its look's bust in the given expression, or the one its state calls for. */
export function portraitFor(
	theme: Theme,
	character: Pick<Character, "id" | "role" | "facts">,
	expression: Expression = expressionFor(character),
): string {
	return portraitOf(theme, lookFor(theme, character), expression);
}

/** One avatar look the operator can choose in Settings. */
export interface AvatarLook {
	look: string;
	/** Its name in Settings: the look's name without its `avatar-` prefix, capitalised. */
	label: string;
	/** Its neutral portrait's URL. */
	portrait: string;
}

/** The theme's avatar looks, in the pack's order; the first is worn until the operator chooses. */
export function avatarLooks(theme: Theme): AvatarLook[] {
	return Object.entries(theme.looks)
		.filter(([, look]) => look.role === "avatar")
		.map(([look]) => {
			const name = look.replace(/^avatar-/, "").replace(/-/g, " ");
			return { look, label: name.charAt(0).toUpperCase() + name.slice(1), portrait: portraitOf(theme, look) };
		});
}

/** The avatar's look: the one chosen in Settings while the theme has it, else the theme's first avatar look. */
export function avatarLookIn(theme: Theme, world: Pick<WorldSnapshot, "avatarLook"> | undefined): string {
	const looks = avatarLooks(theme);
	const chosen = world?.avatarLook;
	return looks.find(({ look }) => look === chosen)?.look ?? looks[0].look;
}
