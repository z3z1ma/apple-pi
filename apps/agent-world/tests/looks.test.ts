import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { Character, CharacterFacts } from "../src/world.js";
import { avatarLookIn, avatarLooks, expressionFor, lookFor, portraitFor } from "../web/looks.js";
import type { Look, Theme } from "../web/theme.js";

// The looks and portraits the world and the conversation panel share, over the fantasy pack's own looks.json.
const looks: Record<string, Look> = JSON.parse(
	readFileSync(fileURLToPath(new URL("../themes/fantasy/characters/looks.json", import.meta.url)), "utf8"),
);
const theme: Theme = { url: "themes/fantasy/", places: {}, looks, labels: {} };

const character = (id: string, facts: Partial<CharacterFacts> = {}): Character => ({
	id,
	name: id,
	role: "worker",
	place: { kind: "common-room", headquarters: "hq" },
	startedAt: 0,
	facts: { status: "idle", unseen: false, ...facts } as CharacterFacts,
});

test("a portrait's expression follows the character's state: asking worried, working thinking, finished happy", () => {
	expect(expressionFor(character("a", { status: "asking" }))).toBe("worried");
	expect(expressionFor(character("a", { status: "working" }))).toBe("thinking");
	expect(expressionFor(character("a", { status: "idle", unseen: true }))).toBe("happy");
	expect(expressionFor(character("a"))).toBe("neutral");
	expect(expressionFor({ facts: undefined })).toBe("neutral");
});

test("portraitFor names the character's own look's portrait file for the expression", () => {
	const docs = character("pi-docs", { status: "working" });
	const look = lookFor(theme, docs);
	expect(looks[look].role).toBe("agent");
	expect(portraitFor(theme, docs)).toBe(`themes/fantasy/characters/${look}-portrait-2.png`);
	expect(portraitFor(theme, docs, "happy")).toBe(`themes/fantasy/characters/${look}-portrait-1.png`);
	expect(portraitFor(theme, { ...docs, role: "coordinator" }, "neutral")).toBe(
		"themes/fantasy/characters/coordinator-portrait-0.png",
	);
	// The same session wears the same look whatever its state.
	expect(lookFor(theme, character("pi-docs", { status: "asking" }))).toBe(look);
});

test("the avatar wears the look chosen in Settings while the theme has it, else the theme's first avatar look", () => {
	expect(avatarLooks(theme).map(({ look, label }) => [look, label])).toEqual([
		["avatar-traveller", "Traveller"],
		["avatar-knight", "Knight"],
		["avatar-bard", "Bard"],
	]);
	expect(avatarLookIn(theme, { avatarLook: "avatar-bard" })).toBe("avatar-bard");
	expect(avatarLookIn(theme, { avatarLook: null })).toBe("avatar-traveller");
	expect(avatarLookIn(theme, { avatarLook: "avatar-gone" })).toBe("avatar-traveller");
	expect(avatarLookIn(theme, undefined)).toBe("avatar-traveller");
});
